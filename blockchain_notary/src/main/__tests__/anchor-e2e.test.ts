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
    "function isNotarized(bytes32 hash) view returns (bool)",
  ]
  const contract = new Contract(NOTARY_ADDRESS!, abi, wallet)

  return {
    isNotarized: async (hash) => Boolean(await contract.isNotarized(hash)),
    sendNotarize: async (hash) => {
      const tx = await contract.notarize(hash)
      return {
        txHash: tx.hash as string,
        wait: async () => {
          const r = await tx.wait()
          return { blockNumber: (r?.blockNumber ?? null) as number | null }
        },
      }
    },
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
})
