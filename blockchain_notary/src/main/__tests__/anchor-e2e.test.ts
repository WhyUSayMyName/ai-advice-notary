import { describe, it, expect } from "vitest"
import { randomBytes } from "node:crypto"
import { createDatabase } from "../database-core"
import { AnchorService, type ChainAdapter } from "../anchor-service"
import { registryId } from "../registry-core"

/**
 * Интеграционная приёмка против реального узла. Запускается только когда
 * окружение поднято (hardhat node + задеплоенный Notary):
 *
 *   E2E_RPC_URL=http://127.0.0.1:8545 \
 *   E2E_NOTARY_ADDRESS=0x... \
 *   E2E_PK=0x... \
 *   npm test
 */
const RPC_URL = process.env.E2E_RPC_URL
const NOTARY_ADDRESS = process.env.E2E_NOTARY_ADDRESS
const PK = process.env.E2E_PK

const enabled = Boolean(RPC_URL && NOTARY_ADDRESS && PK)

async function makeRealAdapter(): Promise<ChainAdapter> {
  const { JsonRpcProvider, Wallet, Contract } = await import("ethers")
  // cacheTimeout: -1 — как в notary.ts: иначе кэш getTransactionCount
  // выдаёт один nonce на две подряд идущие транзакции
  const provider = new JsonRpcProvider(RPC_URL, undefined, { cacheTimeout: -1 })
  const wallet = new Wallet(PK!, provider)
  const abi = [
    "function notarize(bytes32 hash)",
    "function anchorRoot(bytes32 root, uint32 leafCount)",
    "function isNotarized(bytes32 hash) view returns (bool)",
  ]
  const contract = new Contract(NOTARY_ADDRESS!, abi, wallet)

  const asSent = (tx: { hash: string; wait: () => Promise<{ blockNumber: number } | null> }) => ({
    txHash: tx.hash,
    wait: async () => {
      const r = await tx.wait()
      return { blockNumber: (r?.blockNumber ?? null) as number | null }
    },
  })

  const { chainId } = await provider.getNetwork()

  return {
    registry: async () => registryId(chainId, NOTARY_ADDRESS!),
    isNotarized: async (hash) => Boolean(await contract.isNotarized(hash)),
    sendNotarize: async (hash) => asSent(await contract.notarize(hash)),
    sendAnchorRoot: async (root, leafCount) =>
      asSent(await contract.anchorRoot(root, leafCount)),
  }
}

const randomHash = () => "0x" + randomBytes(32).toString("hex")

describe.skipIf(!enabled)("anchor-service e2e против реального узла", () => {
  it("полный цикл: enqueue → sent → confirmed, хеш действительно on-chain", async () => {
    const adapter = await makeRealAdapter()
    const db = createDatabase(":memory:")
    const confirmed: string[] = []
    const service = new AnchorService(db, adapter, (hash) => confirmed.push(hash), undefined, {
      batchWindowMs: 0,
    })

    const hash = randomHash()
    service.enqueue(hash)

    expect(await service.processNext()).toBe("processed")

    const item = db.getAnchorByHash(hash)!
    expect(item.status).toBe("confirmed")
    expect(item.tx_hash).toMatch(/^0x/)
    expect(confirmed).toEqual([hash])
    expect(await adapter.isNotarized(hash)).toBe(true)
    db.close()
  })

  it("падение после отправки: транзакция замайнена, recovery подтверждает БЕЗ повторной отправки", async () => {
    const real = await makeRealAdapter()

    // Адаптер-«авария»: транзакция реально уходит в сеть (и майнится),
    // но ожидание подтверждения обрывается, как при падении приложения
    const crashing: ChainAdapter = {
      registry: real.registry,
      isNotarized: real.isNotarized,
      sendAnchorRoot: real.sendAnchorRoot,
      sendNotarize: async (hash) => {
        const sent = await real.sendNotarize(hash)
        return {
          txHash: sent.txHash,
          wait: async () => {
            throw new Error("app crashed while waiting for confirmation")
          },
        }
      },
    }

    const db = createDatabase(":memory:")
    const confirmed: string[] = []
    const service = new AnchorService(db, crashing, (hash) => confirmed.push(hash), undefined, {
      backoffBaseMs: 60_000, // ретрай не должен успеть сработать сам
      batchWindowMs: 0,
    })

    const hash = randomHash()
    service.enqueue(hash)
    await service.processNext()

    // ожидание оборвалось: запись вернулась в pending с зафиксированным tx_hash
    const afterCrash = db.getAnchorByHash(hash)!
    expect(afterCrash.status).toBe("pending")
    const sentTx = afterCrash.tx_hash
    expect(sentTx).toMatch(/^0x/)

    // Перезапуск случается уже после того, как транзакция попала в блок.
    // Локальный узел майнит мгновенно, а в настоящей сети без этого ожидания
    // recovery не нашёл бы хеш on-chain и тест проверял бы не то
    const { JsonRpcProvider } = await import("ethers")
    const provider = new JsonRpcProvider(RPC_URL)
    await provider.waitForTransaction(sentTx!)
    provider.destroy()

    // «перезапуск»: recovery видит хеш on-chain и подтверждает.
    // Повторная отправка невозможна — контракт бы отклонил дубль,
    // но до отправки дело не доходит.
    const result = await service.recover()
    expect(result.confirmed).toBe(1)

    const recovered = db.getAnchorByHash(hash)!
    expect(recovered.status).toBe("confirmed")
    expect(recovered.tx_hash).toBe(sentTx)
    expect(confirmed).toEqual([hash])
    db.close()
  })

  it("связывание: две эпохи подряд, on-chain лежат головы цепи, а не корни", async () => {
    const { buildMerkleTree } = await import("../merkle-core")
    const { chainRoot, genesisRoot, verifyChain } = await import("../chain-core")

    const adapter = await makeRealAdapter()
    const db = createDatabase(":memory:")
    const service = new AnchorService(db, adapter, () => {}, undefined, { batchWindowMs: 0 })

    const first = [randomHash(), randomHash()]
    const second = [randomHash(), randomHash()]

    for (const h of first) service.enqueue(h)
    await service.processNext()

    for (const h of second) service.enqueue(h)
    await service.processNext()

    // Цепь эпох своя у каждого реестра: без реестра вернулась бы цепь
    // пакетов, созданных до учёта реестров, — здесь она пуста
    const links = db.getChainLinks(await adapter.registry())
    expect(links).toHaveLength(2)

    // Цепочка непрерывна и начинается от генезиса
    const verdict = verifyChain(links)
    expect(verdict.ok).toBe(true)
    expect(links[0].prev).toBe(genesisRoot())
    expect(links[1].prev).toBe(links[0].chainRoot)

    // On-chain лежат именно головы; голые корни пакетов там отсутствуют
    for (const link of links) {
      expect(link.chainRoot).toBe(chainRoot(link.prev, link.batchRoot))
      expect(await adapter.isNotarized(link.chainRoot)).toBe(true)
      expect(await adapter.isNotarized(link.batchRoot)).toBe(false)
    }

    // Документы подтверждены через голову своей эпохи
    const batch = db.getAnchorBatchesForHash(first[0])[0]
    expect(buildMerkleTree(batch.members).root).toBe(batch.root)
    expect(db.getAnchorByHash(first[0])!.status).toBe("confirmed")

    db.close()
  }, 60_000)

  it("батч: 100 документов фиксируются одной транзакцией, каждый проверяем по proof", async () => {
    const { verifyMerkleProof, buildMerkleTree } = await import("../merkle-core")
    const adapter = await makeRealAdapter()
    const db = createDatabase(":memory:")
    const confirmed: string[] = []
    const service = new AnchorService(db, adapter, (hash) => confirmed.push(hash), undefined, {
      batchWindowMs: 0,
    })

    const hashes = Array.from({ length: 100 }, () => randomHash())
    for (const h of hashes) service.enqueue(h)

    expect(await service.processNext()).toBe("processed")

    // все 100 подтверждены одной транзакцией
    expect(confirmed).toHaveLength(100)
    const txs = new Set(hashes.map((h) => db.getAnchorByHash(h)!.tx_hash))
    expect(txs.size).toBe(1)

    // root действительно on-chain, и proof каждого документа сходится к нему
    const batch = db.getAnchorBatchesForHash(hashes[0])[0]
    expect(batch.leaf_count).toBe(100)
    // On-chain лежит голова цепи эпохи, а не голый корень пакета
    expect(await adapter.isNotarized(batch.chain_root!)).toBe(true)

    const tree = buildMerkleTree(batch.members)
    expect(tree.root).toBe(batch.root)
    for (const h of hashes) {
      expect(verifyMerkleProof(h, tree.proofFor(h), batch.root)).toBe(true)
    }

    // сами файловые хеши on-chain отсутствуют — только корень
    expect(await adapter.isNotarized(hashes[0])).toBe(false)
    db.close()
  }, 60_000)
})
