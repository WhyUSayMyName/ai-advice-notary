import { describe, it, expect } from "vitest"
import { randomBytes } from "node:crypto"
import { createDatabase } from "../database-core"
import { AnchorService, type ChainAdapter } from "../anchor-service"

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
  const provider = new JsonRpcProvider(RPC_URL)
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

  return {
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
    const service = new AnchorService(db, adapter, (hash) => confirmed.push(hash))

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
    })

    const hash = randomHash()
    service.enqueue(hash)
    await service.processNext()

    // ожидание оборвалось: запись вернулась в pending с зафиксированным tx_hash
    const afterCrash = db.getAnchorByHash(hash)!
    expect(afterCrash.status).toBe("pending")
    const sentTx = afterCrash.tx_hash
    expect(sentTx).toMatch(/^0x/)

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

  it("батч: 100 документов фиксируются одной транзакцией, каждый проверяем по proof", async () => {
    const { verifyMerkleProof, buildMerkleTree } = await import("../merkle-core")
    const adapter = await makeRealAdapter()
    const db = createDatabase(":memory:")
    const confirmed: string[] = []
    const service = new AnchorService(db, adapter, (hash) => confirmed.push(hash))

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
    expect(await adapter.isNotarized(batch.root)).toBe(true)

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
