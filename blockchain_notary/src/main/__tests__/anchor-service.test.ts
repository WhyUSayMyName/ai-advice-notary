import { describe, it, expect, beforeEach, afterEach } from "vitest"
import { createDatabase, type NotaryDatabase } from "../database-core"
import { AnchorService, type AnchorEvent, type ChainAdapter } from "../anchor-service"

const H = (n: number) => "0x" + String(n).padStart(64, "0")

/** Фейковый чейн: множество зафиксированных хешей + управляемые отказы. */
function makeFakeChain() {
  const onChain = new Set<string>()
  let failSends = 0
  let failWaits = 0
  let sentTxCount = 0
  const anchoredRoots: Array<{ root: string; leafCount: number }> = []

  const makeTx = (target: string) => {
    sentTxCount++
    const txHash = "0xTX_" + target.slice(-4)
    return {
      txHash,
      wait: async () => {
        if (failWaits > 0) {
          failWaits--
          throw new Error("node died while waiting")
        }
        onChain.add(target)
        return { blockNumber: 1 }
      },
    }
  }

  const chain: ChainAdapter = {
    async isNotarized(hash) {
      return onChain.has(hash)
    },
    async sendNotarize(hash) {
      if (failSends > 0) {
        failSends--
        throw new Error("RPC unreachable")
      }
      return makeTx(hash)
    },
    async sendAnchorRoot(root, leafCount) {
      if (failSends > 0) {
        failSends--
        throw new Error("RPC unreachable")
      }
      anchoredRoots.push({ root, leafCount })
      return makeTx(root)
    },
  }

  return {
    chain,
    onChain,
    anchoredRoots,
    txCount: () => sentTxCount,
    setFailSends: (n: number) => (failSends = n),
    setFailWaits: (n: number) => (failWaits = n),
  }
}

describe("anchor-service", () => {
  let db: NotaryDatabase
  let fake: ReturnType<typeof makeFakeChain>
  let events: AnchorEvent[]
  let confirmed: Array<{ hash: string; txHash: string | null }>
  let clock: { now: number }

  function makeService(opts: { maxAttempts?: number } = {}) {
    return new AnchorService(
      db,
      fake.chain,
      (hash, txHash) => confirmed.push({ hash, txHash }),
      (e) => events.push(e),
      {
        maxAttempts: opts.maxAttempts ?? 3,
        backoffBaseMs: 1000,
        backoffMaxMs: 8000,
        now: () => clock.now,
      }
    )
  }

  beforeEach(() => {
    db = createDatabase(":memory:")
    fake = makeFakeChain()
    events = []
    confirmed = []
    clock = { now: 1_000_000 }
  })

  afterEach(() => {
    db.close()
  })

  it("успешный цикл: queued → sent → confirmed, artifact помечается", async () => {
    const service = makeService()
    service.enqueue(H(1))

    expect(await service.processNext()).toBe("processed")

    const item = db.getAnchorByHash(H(1))!
    expect(item.status).toBe("confirmed")
    expect(item.tx_hash).toContain("0xTX_")
    expect(confirmed).toEqual([{ hash: H(1), txHash: item.tx_hash }])
    expect(events.map((e) => e.type)).toEqual(["queued", "sent", "confirmed"])
    expect(fake.onChain.has(H(1))).toBe(true)
  })

  it("хеш уже on-chain — confirmed без отправки транзакции", async () => {
    fake.onChain.add(H(1))
    const service = makeService()
    service.enqueue(H(1))

    await service.processNext()

    expect(db.getAnchorByHash(H(1))!.status).toBe("confirmed")
    expect(events.map((e) => e.type)).toEqual(["queued", "confirmed"])
    expect(confirmed).toHaveLength(1)
  })

  it("дедупликация: повторный enqueue того же хеша не создаёт вторую запись", () => {
    const service = makeService()
    service.enqueue(H(1))
    service.enqueue(H(1))

    expect(db.getAnchorQueue()).toHaveLength(1)
  })

  it("ретрай с экспоненциальным бэкоффом, затем успех", async () => {
    fake.setFailSends(2)
    const service = makeService()
    service.enqueue(H(1))

    // попытка 1: отказ → pending, next_attempt_at = now + 1000
    await service.processNext()
    let item = db.getAnchorByHash(H(1))!
    expect(item.status).toBe("pending")
    expect(item.attempts).toBe(1)
    expect(item.next_attempt_at).toBe(clock.now + 1000)

    // срок не наступил — очередь ждёт
    expect(await service.processNext()).toBe("waiting")

    // попытка 2: отказ → бэкофф удваивается
    clock.now += 1000
    await service.processNext()
    item = db.getAnchorByHash(H(1))!
    expect(item.attempts).toBe(2)
    expect(item.next_attempt_at).toBe(clock.now + 2000)

    // попытка 3: успех
    clock.now += 2000
    await service.processNext()
    expect(db.getAnchorByHash(H(1))!.status).toBe("confirmed")
    expect(events.map((e) => e.type)).toEqual(["queued", "retry", "retry", "sent", "confirmed"])
  })

  it("после maxAttempts запись становится failed, а повторный enqueue реактивирует её", async () => {
    fake.setFailSends(99)
    const service = makeService({ maxAttempts: 2 })
    service.enqueue(H(1))

    await service.processNext()
    clock.now += 10_000
    await service.processNext()

    let item = db.getAnchorByHash(H(1))!
    expect(item.status).toBe("failed")
    expect(item.attempts).toBe(2)
    expect(item.last_error).toContain("RPC unreachable")

    // ручной повтор: enqueue сбрасывает failed в pending
    service.enqueue(H(1))
    item = db.getAnchorByHash(H(1))!
    expect(item.status).toBe("pending")
    expect(item.attempts).toBe(0)
  })

  it("сбой во время ожидания подтверждения → ретрай без дубля on-chain", async () => {
    fake.setFailWaits(1)
    const service = makeService()
    service.enqueue(H(1))

    // отправка прошла, ожидание упало → запись вернулась в pending
    await service.processNext()
    expect(db.getAnchorByHash(H(1))!.status).toBe("pending")

    // транзакция на самом деле НЕ попала в блок (фейк не добавил хеш) —
    // повторная попытка отправляет заново и подтверждает
    clock.now += 10_000
    await service.processNext()
    expect(db.getAnchorByHash(H(1))!.status).toBe("confirmed")
  })

  it("recovery: sent-запись, чья транзакция успела попасть в блок, подтверждается без повторной отправки", async () => {
    const service = makeService()
    const item = service.enqueue(H(1))

    // имитация сбоя: транзакция отправлена и замайнена, но приложение упало
    db.markAnchorSent(item.id, "0xDEAD")
    fake.onChain.add(H(1))

    const result = await service.recover()

    expect(result.confirmed).toBe(1)
    const after = db.getAnchorByHash(H(1))!
    expect(after.status).toBe("confirmed")
    expect(after.tx_hash).toBe("0xDEAD")
    expect(confirmed).toEqual([{ hash: H(1), txHash: "0xDEAD" }])
  })

  it("recovery: sent-запись без транзакции в чейне возвращается в pending", async () => {
    const service = makeService()
    const item = service.enqueue(H(1))
    db.markAnchorSent(item.id, "0xDROPPED")

    const result = await service.recover()

    expect(result.requeued).toBe(1)
    expect(db.getAnchorByHash(H(1))!.status).toBe("pending")

    // и воркер дожимает фиксацию
    await service.processNext()
    expect(db.getAnchorByHash(H(1))!.status).toBe("confirmed")
  })

  it("батч: несколько due-записей фиксируются одной транзакцией anchorRoot", async () => {
    const service = makeService()
    service.enqueue(H(1))
    service.enqueue(H(2))
    service.enqueue(H(3))

    expect(await service.processNext()).toBe("processed")

    // одна транзакция на три документа
    expect(fake.txCount()).toBe(1)
    expect(fake.anchoredRoots).toHaveLength(1)
    expect(fake.anchoredRoots[0].leafCount).toBe(3)

    for (const h of [H(1), H(2), H(3)]) {
      const item = db.getAnchorByHash(h)!
      expect(item.status).toBe("confirmed")
      expect(item.tx_hash).toBe(db.getAnchorByHash(H(1))!.tx_hash)
    }

    // состав пакета сохранён и связан с транзакцией
    const batch = db.getAnchorBatchesForHash(H(2))[0]
    expect(batch.members).toEqual([H(1), H(2), H(3)].sort())
    expect(batch.tx_hash).toBe(db.getAnchorByHash(H(1))!.tx_hash)
    expect(confirmed).toHaveLength(3)
  })

  it("батч: отказ до отправки откатывает пакет и переносит все записи", async () => {
    fake.setFailSends(1)
    const service = makeService()
    service.enqueue(H(1))
    service.enqueue(H(2))

    await service.processNext()

    expect(db.getAnchorByHash(H(1))!.status).toBe("pending")
    expect(db.getAnchorByHash(H(2))!.status).toBe("pending")
    // пакет откатился — состав не должен засорять recovery
    expect(db.getAnchorBatchesForHash(H(1))).toHaveLength(0)

    // следующая попытка успешна
    clock.now += 10_000
    await service.processNext()
    expect(db.getAnchorByHash(H(1))!.status).toBe("confirmed")
    expect(db.getAnchorByHash(H(2))!.status).toBe("confirmed")
  })

  it("батч: обрыв ожидания сохраняет состав, recovery подтверждает через root", async () => {
    fake.setFailWaits(1)
    const service = makeService()
    service.enqueue(H(1))
    service.enqueue(H(2))

    // отправка прошла (root попал в fake.anchoredRoots), ожидание оборвалось
    await service.processNext()
    expect(db.getAnchorByHash(H(1))!.status).toBe("pending")
    expect(db.getAnchorBatchesForHash(H(1))).toHaveLength(1)

    // «транзакция всё-таки замайнилась, пока приложение лежало»
    fake.onChain.add(fake.anchoredRoots[0].root)

    const result = await service.recover()
    expect(result.confirmed).toBe(2)
    expect(db.getAnchorByHash(H(1))!.status).toBe("confirmed")
    expect(db.getAnchorByHash(H(2))!.status).toBe("confirmed")
    // повторной транзакции не было
    expect(fake.txCount()).toBe(1)
  })

  it("recovery при недоступном узле не роняет сервис и не трогает записи", async () => {
    const brokenChain: ChainAdapter = {
      isNotarized: async () => {
        throw new Error("ECONNREFUSED")
      },
      sendNotarize: async () => {
        throw new Error("ECONNREFUSED")
      },
      sendAnchorRoot: async () => {
        throw new Error("ECONNREFUSED")
      },
    }
    const service = new AnchorService(db, brokenChain, () => {}, undefined, {
      now: () => clock.now,
    })
    service.enqueue(H(1))

    const result = await service.recover()

    expect(result).toEqual({ confirmed: 0, requeued: 0 })
    expect(db.getAnchorByHash(H(1))!.status).toBe("pending")
  })
})
