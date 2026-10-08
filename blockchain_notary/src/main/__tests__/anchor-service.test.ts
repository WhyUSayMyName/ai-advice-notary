import { describe, it, expect, beforeEach, afterEach } from "vitest"
import { createDatabase, type NotaryDatabase } from "../database-core"
import { AnchorService, type AnchorEvent, type ChainAdapter } from "../anchor-service"
import { buildMerkleTree } from "../merkle-core"
import { chainRoot, genesisRoot, verifyChain } from "../chain-core"

const H = (n: number) => "0x" + String(n).padStart(64, "0")

const LOCAL = "31337:0x" + "a".repeat(40)
const SEPOLIA = "11155111:0x" + "b".repeat(40)

/**
 * Фейковый чейн: множество зафиксированных хешей + управляемые отказы.
 * Сетей несколько, у каждой свой реестр; переключение имитирует смену
 * узла и контракта в настройках приложения.
 */
function makeFakeChain() {
  const networks = new Map<string, Set<string>>([[LOCAL, new Set()]])
  let current = LOCAL
  const net = () => networks.get(current)!
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
        net().add(target)
        return { blockNumber: 1 }
      },
    }
  }

  const chain: ChainAdapter = {
    async registry() {
      return current
    },
    async isNotarized(hash) {
      return net().has(hash)
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
    get onChain() {
      return net()
    },
    useNetwork(registry: string) {
      if (!networks.has(registry)) networks.set(registry, new Set())
      current = registry
    },
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

  function makeService(opts: { maxAttempts?: number; batchWindowMs?: number } = {}) {
    return new AnchorService(
      db,
      fake.chain,
      (hash, txHash) => confirmed.push({ hash, txHash }),
      (e) => events.push(e),
      {
        maxAttempts: opts.maxAttempts ?? 3,
        backoffBaseMs: 1000,
        backoffMaxMs: 8000,
        // По умолчанию окно накопления выключено: большинство тестов шагают
        // по очереди вручную и не должны зависеть от таймингов
        batchWindowMs: opts.batchWindowMs ?? 0,
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

  it("окно накопления: одиночная запись не уходит сразу, ждёт соседей", async () => {
    const service = makeService({ batchWindowMs: 10_000 })
    service.enqueue(H(1))

    // Сразу после добавления отправлять нельзя — иначе пакет никогда
    // не соберётся, и батчинг не работает в реальном использовании
    expect(await service.processNext()).toBe("waiting")
    expect(fake.txCount()).toBe(0)
    expect(service.batchReadyAt).toBe(clock.now + 10_000)

    // Подтянулся сосед — окно отсчитывается от него
    clock.now += 4000
    service.enqueue(H(2))
    expect(await service.processNext()).toBe("waiting")
    expect(fake.txCount()).toBe(0)

    // Окно закрылось — обе записи уходят одной транзакцией
    clock.now += 10_000
    expect(await service.processNext()).toBe("processed")
    expect(fake.txCount()).toBe(1)
    expect(fake.anchoredRoots[0].leafCount).toBe(2)
  })

  it("окно накопления: старая запись не ждёт дольше потолка", async () => {
    const service = makeService({ batchWindowMs: 10_000 })
    service.enqueue(H(1))

    // Поток новых записей продлевал бы окно бесконечно, но потолок
    // batchMaxWaitMs (по умолчанию 60 с) отсчитывается от самой старой
    for (let i = 0; i < 12; i++) {
      clock.now += 8000
      service.enqueue(H(i + 2))
      const result = await service.processNext()
      if (result === "processed") break
    }

    expect(fake.txCount()).toBe(1)
  })

  it("окно накопления: полный пакет уходит немедленно", async () => {
    const service = makeService({ batchWindowMs: 10_000, maxAttempts: 3 })
    // maxBatchSize по умолчанию 256 — проверяем через flush, что ручной
    // запуск не ждёт окна
    service.enqueue(H(1))
    service.enqueue(H(2))
    expect(await service.processNext()).toBe("waiting")

    service.flush()
    expect(await service.processNext()).toBe("processed")
    expect(fake.txCount()).toBe(1)
  })

  it("окно накопления: повторную попытку не задерживаем", async () => {
    fake.setFailSends(1)
    const service = makeService({ batchWindowMs: 10_000 })

    service.enqueue(H(1))
    service.flush()
    await service.processNext() // отказ, запись уходит в ретрай

    expect(db.getAnchorByHash(H(1))!.attempts).toBe(1)

    // Её срок уже наступил — окно накопления к ней не применяется
    clock.now += 5000
    expect(await service.processNext()).toBe("processed")
    expect(db.getAnchorByHash(H(1))!.status).toBe("confirmed")
  })

  it("связывание: on-chain уходит голова цепи, а не голый корень пакета", async () => {
    const service = makeService()
    service.enqueue(H(1))
    service.enqueue(H(2))

    await service.processNext()

    const batch = db.getAnchorBatchesForHash(H(1))[0]
    const tree = buildMerkleTree([H(1), H(2)])

    // Первая эпоха ссылается на генезис
    expect(batch.prev_chain_root).toBe(genesisRoot())
    expect(batch.chain_root).toBe(chainRoot(genesisRoot(), tree.root))

    // Заякорена именно голова, корень пакета on-chain отсутствует
    expect(fake.anchoredRoots[0].root).toBe(batch.chain_root)
    expect(fake.onChain.has(batch.chain_root!)).toBe(true)
    expect(fake.onChain.has(tree.root)).toBe(false)
  })

  it("связывание: вторая эпоха ссылается на первую, цепочка непрерывна", async () => {
    const service = makeService()

    service.enqueue(H(1))
    service.enqueue(H(2))
    await service.processNext()

    service.enqueue(H(3))
    service.enqueue(H(4))
    await service.processNext()

    const links = db.getChainLinks(LOCAL)
    expect(links).toHaveLength(2)
    expect(links[1].prev).toBe(links[0].chainRoot)

    const verdict = verifyChain(links)
    expect(verdict.ok).toBe(true)
    if (verdict.ok) expect(verdict.head).toBe(db.getChainHead(LOCAL))
  })

  it("связывание: изъятие эпохи из середины ломает проверку непрерывности", async () => {
    const service = makeService()

    for (const pair of [[H(1), H(2)], [H(3), H(4)], [H(5), H(6)]]) {
      for (const h of pair) service.enqueue(h)
      await service.processNext()
    }

    const links = db.getChainLinks(LOCAL)
    expect(verifyChain(links).ok).toBe(true)

    // Оператор предъявляет историю без второй эпохи
    const withHole = [links[0], links[2]]
    const verdict = verifyChain(withHole)

    expect(verdict.ok).toBe(false)
    if (!verdict.ok) expect(verdict.reason).toContain("изъята")
  })

  it("совместимость: пакет без связывания подтверждается по голому корню", async () => {
    const service = makeService()
    const tree = buildMerkleTree([H(1), H(2)])

    // Пакет, созданный до появления связывания: chain_root отсутствует
    db.createAnchorBatch(tree.root, [H(1), H(2)])
    db.setAnchorBatchTx(tree.root, "0xLEGACY")
    fake.onChain.add(tree.root)

    service.enqueue(H(1))
    await service.processNext()

    // Найден по голому корню, повторная отправка не потребовалась
    expect(db.getAnchorByHash(H(1))!.status).toBe("confirmed")
    expect(db.getAnchorByHash(H(1))!.tx_hash).toBe("0xLEGACY")
    expect(fake.txCount()).toBe(0)
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

  it("реестр: пакет и записи очереди помечаются реестром, куда ушла транзакция", async () => {
    const service = makeService()
    service.enqueue(H(1))
    service.enqueue(H(2))
    await service.processNext()

    expect(db.getAnchorBatchesForHash(H(1))[0].registry).toBe(LOCAL)
    expect(db.getAnchorByHash(H(1))!.registry).toBe(LOCAL)
    expect(db.getAnchorRegistriesForHash(H(1))).toEqual([LOCAL])
  })

  it("реестр: одиночная фиксация тоже помечается", async () => {
    const service = makeService()
    service.enqueue(H(1))
    await service.processNext()

    expect(db.getAnchorByHash(H(1))!.registry).toBe(LOCAL)
    expect(db.getAnchorRegistriesForHash(H(1))).toEqual([LOCAL])
  })

  it("реестр: цепь эпох новой сети начинается с генезиса, а не с головы старой", async () => {
    const service = makeService()
    service.enqueue(H(1))
    service.enqueue(H(2))
    await service.processNext()

    fake.useNetwork(SEPOLIA)
    service.enqueue(H(3))
    service.enqueue(H(4))
    await service.processNext()

    // Звено, заякоренное на локальном узле, аудитор Sepolia проверить не
    // может: связка с ним выглядела бы у него как начало истории без начала
    const sepoliaLinks = db.getChainLinks(SEPOLIA)
    expect(sepoliaLinks).toHaveLength(1)
    expect(sepoliaLinks[0].prev).toBe(genesisRoot())

    expect(verifyChain(db.getChainLinks(LOCAL)).ok).toBe(true)
    expect(verifyChain(sepoliaLinks).ok).toBe(true)
  })

  it("реестр: заякоренный в другой сети документ якорится и в текущей", async () => {
    const service = makeService()
    service.enqueue(H(1))
    service.enqueue(H(2))
    await service.processNext()
    expect(fake.txCount()).toBe(1)

    // Тот же состав документов в новой сети. Без реактивации запись осталась
    // бы confirmed навсегда, не будучи в текущем реестре
    fake.useNetwork(SEPOLIA)
    service.enqueue(H(1), undefined, SEPOLIA)
    service.enqueue(H(2), undefined, SEPOLIA)
    expect(db.getAnchorByHash(H(1))!.status).toBe("pending")

    await service.processNext()

    expect(fake.txCount()).toBe(2)
    expect(db.getAnchorByHash(H(1))!.status).toBe("confirmed")
    expect(db.getAnchorByHash(H(1))!.registry).toBe(SEPOLIA)

    // Корень у пакетов совпал, но это две разные эпохи двух реестров
    const batches = db.getAnchorBatchesForHash(H(1))
    expect(batches.map((b) => b.registry).sort()).toEqual([LOCAL, SEPOLIA].sort())
    expect(batches[0].root).toBe(batches[1].root)
    expect(batches[0].chain_root).toBe(batches[1].chain_root) // оба от генезиса
    expect(db.getAnchorRegistriesForHash(H(1)).sort()).toEqual([LOCAL, SEPOLIA].sort())
  })

  it("реестр: повторная постановка в том же реестре не реактивирует запись", async () => {
    const service = makeService()
    service.enqueue(H(1))
    await service.processNext()

    service.enqueue(H(1), undefined, LOCAL)

    expect(db.getAnchorByHash(H(1))!.status).toBe("confirmed")
    expect(fake.txCount()).toBe(1)
  })

  it("реестр: при старте старые пакеты, найденные on-chain, получают метку", async () => {
    const service = makeService()
    const found = buildMerkleTree([H(1), H(2)])
    const lost = buildMerkleTree([H(3), H(4)])

    // Пакеты до учёта реестров: один лежит в текущей сети, второго в ней нет
    db.createAnchorBatch(found.root, [H(1), H(2)])
    db.setAnchorBatchTx(found.root, "0xOLD1")
    db.createAnchorBatch(lost.root, [H(3), H(4)])
    db.setAnchorBatchTx(lost.root, "0xOLD2")
    fake.onChain.add(found.root)

    // И подтверждённая одиночная фиксация без реестра
    const single = db.enqueueAnchor(H(5))
    db.markAnchorConfirmed(single.id, "0xOLD3")
    fake.onChain.add(H(5))

    await service.recover()

    expect(db.getAnchorBatch(found.root, LOCAL)?.tx_hash).toBe("0xOLD1")
    expect(db.getAnchorBatch(found.root, null)).toBeUndefined()
    expect(db.getAnchorBatch(lost.root, null)?.registry).toBeNull()
    expect(db.getAnchorByHash(H(5))!.registry).toBe(LOCAL)
    expect(fake.txCount()).toBe(0)
  })

  it("recovery при недоступном узле не роняет сервис и не трогает записи", async () => {
    const brokenChain: ChainAdapter = {
      registry: async () => {
        throw new Error("ECONNREFUSED")
      },
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
