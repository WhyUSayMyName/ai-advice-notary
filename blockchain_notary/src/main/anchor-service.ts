import type { AnchorQueueItem, NotaryDatabase } from "./database-core"
import { buildMerkleTree } from "./merkle-core"
import { chainRoot, genesisRoot } from "./chain-core"

/**
 * Адаптер взаимодействия с чейном. Выделен в интерфейс, чтобы сервис
 * можно было тестировать без узла и чтобы отправка была отделена
 * от ожидания подтверждения (важно для восстановления после сбоя).
 */
export type ChainAdapter = {
  /**
   * Идентификатор реестра (chainId + адрес контракта, см. registry-core.ts),
   * куда уходят транзакции по этому адресу узла. Им помечается каждая
   * фиксация, и по нему же разделяются цепи эпох разных сетей.
   */
  registry(rpcUrl?: string): Promise<string>
  isNotarized(hash: string, rpcUrl?: string): Promise<boolean>
  sendNotarize(
    hash: string,
    rpcUrl?: string
  ): Promise<{ txHash: string; wait: () => Promise<{ blockNumber: number | null }> }>
  sendAnchorRoot(
    root: string,
    leafCount: number,
    rpcUrl?: string
  ): Promise<{ txHash: string; wait: () => Promise<{ blockNumber: number | null }> }>
}

export type AnchorEvent = {
  type: "queued" | "sent" | "confirmed" | "retry" | "failed" | "recovered"
  item: AnchorQueueItem
}

export type AnchorServiceOptions = {
  /** Максимум попыток до статуса failed (по умолчанию 8). */
  maxAttempts?: number
  /** База экспоненциального бэкоффа, мс (по умолчанию 5000). */
  backoffBaseMs?: number
  /** Потолок бэкоффа, мс (по умолчанию 5 минут). */
  backoffMaxMs?: number
  /** Пауза цикла при пустой очереди, мс (по умолчанию 15000). */
  idleMs?: number
  /** Максимум документов в одном merkle-пакете (по умолчанию 256). */
  maxBatchSize?: number
  /**
   * Окно накопления пакета от последнего поступления, мс (по умолчанию 15000).
   * 0 отключает — каждая запись уходит немедленно.
   */
  batchWindowMs?: number
  /** Потолок ожидания для самой старой записи, мс (по умолчанию 60000). */
  batchMaxWaitMs?: number
  /**
   * Сколько ждать подтверждения отправленной транзакции, мс (по умолчанию
   * 10 минут). Воркер последовательный: зависшая в настоящей сети транзакция
   * без этого блокировала бы всю очередь до перезапуска приложения.
   */
  confirmTimeoutMs?: number
  /** Часы — подменяются в тестах. */
  now?: () => number
  /** Ограничение ожидания по времени — подменяется в тестах, где таймеров нет. */
  withTimeout?: <T>(promise: Promise<T>, ms: number) => Promise<T>
}

function withRealTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(
      () => reject(new Error(`подтверждение не пришло за ${Math.round(ms / 1000)} с`)),
      ms
    )
    promise.then(
      (v) => {
        clearTimeout(timer)
        resolve(v)
      },
      (e) => {
        clearTimeout(timer)
        reject(e)
      }
    )
  })
}

export type ProcessResult = "processed" | "waiting" | "empty"

/**
 * Последовательный воркер фиксации хешей в блокчейне.
 *
 * Последовательность неслучайна: один in-flight запрос исключает проблемы
 * с nonce и делает поведение при сбоях детерминированным. Пропускной
 * способности локальной очереди этого достаточно; масштабирование —
 * через пакетную фиксацию (Merkle), а не через параллелизм.
 */
export class AnchorService {
  private readonly maxAttempts: number
  private readonly backoffBaseMs: number
  private readonly backoffMaxMs: number
  private readonly idleMs: number
  private readonly maxBatchSize: number
  private readonly batchWindowMs: number
  private readonly batchMaxWaitMs: number
  private readonly confirmTimeoutMs: number
  private readonly now: () => number
  private readonly withTimeout: <T>(promise: Promise<T>, ms: number) => Promise<T>

  private running = false
  private wake: (() => void) | null = null
  private holdUntil: number | null = null
  private flushRequested = false

  constructor(
    private readonly db: NotaryDatabase,
    private readonly chain: ChainAdapter,
    private readonly onConfirmed: (hash: string, txHash: string | null) => void,
    private readonly onEvent?: (event: AnchorEvent) => void,
    options: AnchorServiceOptions = {}
  ) {
    this.maxAttempts = options.maxAttempts ?? 8
    this.backoffBaseMs = options.backoffBaseMs ?? 5_000
    this.backoffMaxMs = options.backoffMaxMs ?? 5 * 60_000
    this.idleMs = options.idleMs ?? 15_000
    this.maxBatchSize = options.maxBatchSize ?? 256
    this.batchWindowMs = options.batchWindowMs ?? 15_000
    this.batchMaxWaitMs = options.batchMaxWaitMs ?? 60_000
    this.confirmTimeoutMs = options.confirmTimeoutMs ?? 10 * 60_000
    this.now = options.now ?? Date.now
    this.withTimeout = options.withTimeout ?? withRealTimeout
  }

  /**
   * Ставит хеш в очередь и будит воркер. Мгновенно, без сети.
   * registry — реестр, в котором документ должен оказаться; если хеш
   * заякорен в другом, запись реактивируется (см. enqueueAnchor).
   */
  enqueue(hash: string, rpcUrl?: string, registry?: string): AnchorQueueItem {
    const item = this.db.enqueueAnchor(hash, rpcUrl, this.now(), registry)
    this.emit({ type: "queued", item })
    this.kick()
    return item
  }

  /**
   * Восстановление после перезапуска: незавершённые записи сверяются
   * с чейном. Уже зафиксированные — подтверждаются (транзакция успела
   * попасть в блок до сбоя), отправленные-но-не-найденные возвращаются
   * в pending для повторной отправки. Дублей on-chain не возникает:
   * перед каждой отправкой воркер проверяет isNotarized.
   */
  async recover(): Promise<{ confirmed: number; requeued: number }> {
    let confirmed = 0
    let requeued = 0

    await this.adoptLegacyRegistries()

    for (const item of this.db.getUnconfirmedAnchors()) {
      try {
        const anchored = await this.findAnchoredEvidence(item)

        if (anchored) {
          this.db.markAnchorConfirmed(item.id, anchored.txHash ?? item.tx_hash, anchored.registry)
          this.onConfirmed(item.hash, anchored.txHash ?? item.tx_hash)
          confirmed++
          this.emit({ type: "recovered", item: this.db.getAnchorByHash(item.hash)! })
        } else if (item.status === "sent") {
          this.db.rescheduleAnchor(item.id, item.attempts, 0, "recovered after restart")
          requeued++
        }
      } catch {
        // Узел недоступен — запись остаётся как есть, воркер дойдёт до неё сам
      }
    }

    this.kick()
    return { confirmed, requeued }
  }

  /**
   * Записи, заякоренные до учёта реестров, не знают, где лежат. Узнать это
   * можно только у чейна: что нашлось в реестре по умолчанию, получает его
   * метку. Не найденное остаётся без метки — аудит покажет его как
   * «реестр неизвестен», а не как подмену.
   */
  private async adoptLegacyRegistries() {
    let registry: string
    try {
      registry = await this.chain.registry()
    } catch {
      return // Узел недоступен — сверка подождёт следующего запуска
    }

    for (const batch of this.db.getUnassignedBatches()) {
      try {
        if (await this.chain.isNotarized(batch.chain_root ?? batch.root)) {
          this.db.assignBatchRegistry(batch.root, registry)
        }
      } catch {
        return
      }
    }

    for (const item of this.db.getUnassignedConfirmedAnchors()) {
      try {
        const viaBatch = this.db
          .getAnchorBatchesForHash(item.hash, registry)
          .some((b) => b.registry === registry && b.tx_hash !== null)
        if (viaBatch || (await this.chain.isNotarized(item.hash))) {
          this.db.setAnchorRegistry(item.id, registry)
        }
      } catch {
        return
      }
    }
  }

  /**
   * Проверяет, заякорен ли хеш on-chain в реестре записи: напрямую
   * (одиночная фиксация) или через корень merkle-пакета, в который он входил.
   */
  private async findAnchoredEvidence(
    item: AnchorQueueItem
  ): Promise<{ txHash: string | null; registry: string } | null> {
    const rpcUrl = item.rpc_url ?? undefined
    const registry = await this.chain.registry(rpcUrl)

    if (await this.chain.isNotarized(item.hash, rpcUrl)) {
      return { txHash: item.tx_hash, registry }
    }

    // Пакеты чужих реестров в этой сети искать бессмысленно
    for (const batch of this.db.getAnchorBatchesForHash(item.hash, registry)) {
      // Связанные эпохи заякорены головой цепи; у пакетов, созданных до
      // появления связывания, on-chain лежит голый корень
      const anchored = batch.chain_root ?? batch.root
      if (await this.chain.isNotarized(anchored, rpcUrl)) {
        // Пакет без метки нашёлся здесь — теперь известно, где он лежит
        if (batch.registry === null) this.db.assignBatchRegistry(batch.root, registry)
        return { txHash: batch.tx_hash, registry }
      }
    }

    return null
  }

  /**
   * Обрабатывает созревшие записи очереди: одиночную — прямой фиксацией,
   * несколько — merkle-пакетом одной транзакцией. Вынесено из цикла,
   * чтобы тесты могли шагать по очереди без таймеров и реального времени.
   */
  async processNext(): Promise<ProcessResult> {
    const due = this.db.getDueAnchors(this.now(), this.maxBatchSize)

    if (due.length === 0) {
      this.holdUntil = null
      return this.db.getNextAnchorAttemptAt() !== undefined ? "waiting" : "empty"
    }

    // Окно накопления. Без него воркер просыпался на каждое добавление и
    // якорил запись поодиночке: пакет собирался лишь при случайном совпадении,
    // и экономия ради которой строился merkle-батчинг не работала.
    const hold = this.batchHoldUntil(due)
    if (hold !== null) {
      this.holdUntil = hold
      return "waiting"
    }
    this.holdUntil = null

    // Уже заякоренные (напрямую или через пакет) подтверждаются без отправки
    const remaining: AnchorQueueItem[] = []
    for (const item of due) {
      try {
        const anchored = await this.findAnchoredEvidence(item)
        if (anchored) {
          this.db.markAnchorConfirmed(item.id, anchored.txHash ?? item.tx_hash, anchored.registry)
          this.onConfirmed(item.hash, anchored.txHash ?? item.tx_hash)
          this.emit({ type: "confirmed", item: this.db.getAnchorByHash(item.hash)! })
        } else {
          remaining.push(item)
        }
      } catch (e) {
        this.rescheduleAfterError(item, e)
      }
    }

    if (remaining.length === 0) return "processed"

    // Пакет, отправленный раньше и не дошедший до блока, переотправляется
    // ровно в прежнем составе: тогда и связка эпохи прежняя. Новые записи
    // подождут следующего прохода — иначе корень изменится, и в цепи
    // останется звено, которое никогда не попало в реестр.
    let inflight: AnchorQueueItem[] | null
    try {
      inflight = await this.inflightGroup(remaining)
    } catch (e) {
      for (const item of remaining) this.rescheduleAfterError(item, e)
      return "processed"
    }

    if (inflight) {
      await this.processBatch(inflight)
    } else if (remaining.length === 1) {
      await this.processSingle(remaining[0])
    } else {
      await this.processBatch(remaining)
    }

    return "processed"
  }

  /**
   * Записи пакета, транзакция которого уже уходила, но подтверждения не
   * дождалась (обрыв или таймаут). null — таких нет или состав неполон
   * (часть записей окончательно провалена): тогда собирается новый пакет.
   */
  private async inflightGroup(remaining: AnchorQueueItem[]): Promise<AnchorQueueItem[] | null> {
    const registry = await this.chain.registry(remaining[0].rpc_url ?? undefined)
    const byHash = new Map(remaining.map((i) => [i.hash, i]))

    for (const item of remaining) {
      const sent = this.db
        .getAnchorBatchesForHash(item.hash, registry)
        .find((b) => b.registry === registry && b.tx_hash !== null && b.chain_root !== null)
      if (sent && sent.members.every((h) => byHash.has(h))) {
        return sent.members.map((h) => byHash.get(h)!)
      }
    }
    return null
  }

  /**
   * До какого момента придержать отправку, чтобы к записи успели подтянуться
   * соседи. null — ждать больше нечего, можно якорить.
   *
   * Правила: окно отсчитывается от последнего поступления, но общее ожидание
   * ограничено — документ не должен висеть бесконечно из-за потока новых.
   * Полный пакет и ручной запуск отправляются немедленно.
   */
  private batchHoldUntil(due: AnchorQueueItem[]): number | null {
    if (this.flushRequested) {
      this.flushRequested = false
      return null
    }
    if (this.batchWindowMs <= 0 || due.length >= this.maxBatchSize) return null

    const now = this.now()
    const newest = Math.max(...due.map((i) => i.created_at))
    const oldest = Math.min(...due.map((i) => i.created_at))

    // Повторные попытки не задерживаем: их время уже пришло
    if (due.some((i) => i.attempts > 0)) return null

    const windowEnds = newest + this.batchWindowMs
    const deadline = oldest + this.batchMaxWaitMs
    const until = Math.min(windowEnds, deadline)

    return until > now ? until : null
  }

  /** Отправить накопленное немедленно, не дожидаясь окна. */
  flush() {
    this.flushRequested = true
    this.holdUntil = null
    this.kick()
  }

  /** Момент, когда придержанный пакет будет отправлен (для интерфейса). */
  get batchReadyAt(): number | null {
    return this.holdUntil
  }

  private async processSingle(item: AnchorQueueItem) {
    try {
      const rpcUrl = item.rpc_url ?? undefined
      const registry = await this.chain.registry(rpcUrl)
      const { txHash, wait } = await this.chain.sendNotarize(item.hash, rpcUrl)
      this.db.markAnchorSent(item.id, txHash, registry)
      this.emit({ type: "sent", item: this.db.getAnchorByHash(item.hash)! })

      await this.withTimeout(wait(), this.confirmTimeoutMs)

      this.db.markAnchorConfirmed(item.id, txHash, registry)
      this.onConfirmed(item.hash, txHash)
      this.emit({ type: "confirmed", item: this.db.getAnchorByHash(item.hash)! })
    } catch (e) {
      this.rescheduleAfterError(item, e)
    }
  }

  private async processBatch(items: AnchorQueueItem[]) {
    const tree = buildMerkleTree(items.map((i) => i.hash))
    const rpcUrl = items[0].rpc_url ?? undefined

    let registry: string
    try {
      registry = await this.chain.registry(rpcUrl)
    } catch (e) {
      for (const item of items) this.rescheduleAfterError(item, e)
      return
    }

    // Эпоха связывается с предыдущей эпохой того же реестра: on-chain уходит
    // голова цепи, а не голый корень пакета. Так изъятие эпохи из середины
    // истории становится видимым. Повторная отправка того же состава берёт
    // прежнюю связку: голова цепи сейчас — это она сама, и связать эпоху
    // с собой значило бы заякорить не то значение, что записано в базе.
    const previous = this.db.getAnchorBatch(tree.root, registry)
    const prevChainRoot =
      previous?.prev_chain_root ?? this.db.getChainHead(registry) ?? genesisRoot()
    const head = previous?.chain_root ?? chainRoot(prevChainRoot, tree.root)

    // Состав пакета и связка фиксируются до отправки: если приложение упадёт
    // после сабмита транзакции, recovery восстановит связь hash → root → голова
    this.db.createAnchorBatch(
      tree.root,
      items.map((i) => i.hash),
      { prevChainRoot, chainRoot: head },
      registry
    )

    let txHash: string
    let wait: () => Promise<{ blockNumber: number | null }>
    try {
      const existing = this.db.getAnchorBatch(tree.root, registry)
      if (existing?.tx_hash && (await this.chain.isNotarized(head, rpcUrl))) {
        // Тот же состав уже заякорен предыдущей попыткой
        this.confirmBatchItems(items, existing.tx_hash, registry)
        return
      }

      const sent = await this.chain.sendAnchorRoot(head, tree.leafCount, rpcUrl)
      txHash = sent.txHash
      wait = sent.wait
    } catch (e) {
      // Транзакция не ушла — новый пакет откатывается, записи ждут следующей
      // попытки. Пакет, чья транзакция уже уходила раньше, остаётся: она ещё
      // может оказаться в блоке, и тогда recovery найдёт его голову
      if (!previous?.tx_hash) this.db.deleteAnchorBatch(tree.root, registry)
      for (const item of items) this.rescheduleAfterError(item, e)
      return
    }

    this.db.setAnchorBatchTx(tree.root, txHash, registry)
    for (const item of items) {
      this.db.markAnchorSent(item.id, txHash, registry)
      this.emit({ type: "sent", item: this.db.getAnchorByHash(item.hash)! })
    }

    try {
      await this.withTimeout(wait(), this.confirmTimeoutMs)
    } catch (e) {
      // Транзакция ушла, но подтверждение оборвалось или не пришло вовремя:
      // состав пакета сохранён, следующая попытка (или recovery) увидит
      // голову on-chain и подтвердит, а если транзакция пропала — отправит
      // тот же пакет заново
      for (const item of items) this.rescheduleAfterError(item, e)
      return
    }

    this.confirmBatchItems(items, txHash, registry)
  }

  private confirmBatchItems(items: AnchorQueueItem[], txHash: string, registry: string) {
    for (const item of items) {
      this.db.markAnchorConfirmed(item.id, txHash, registry)
      this.onConfirmed(item.hash, txHash)
      this.emit({ type: "confirmed", item: this.db.getAnchorByHash(item.hash)! })
    }
  }

  private rescheduleAfterError(item: AnchorQueueItem, e: unknown) {
    const message = e instanceof Error ? e.message : String(e)
    const attempts = item.attempts + 1

    if (attempts >= this.maxAttempts) {
      this.db.markAnchorFailed(item.id, attempts, message)
      this.emit({ type: "failed", item: this.db.getAnchorByHash(item.hash)! })
    } else {
      const backoff = Math.min(this.backoffBaseMs * 2 ** (attempts - 1), this.backoffMaxMs)
      this.db.rescheduleAnchor(item.id, attempts, this.now() + backoff, message)
      this.emit({ type: "retry", item: this.db.getAnchorByHash(item.hash)! })
    }
  }

  /** Запускает фоновый цикл обработки. */
  start() {
    if (this.running) return
    this.running = true
    void this.loop()
  }

  stop() {
    this.running = false
    this.kick()
  }

  private async loop() {
    while (this.running) {
      let result: ProcessResult
      try {
        result = await this.processNext()
      } catch {
        result = "waiting"
      }

      if (result === "processed") continue

      let delay = this.idleMs
      if (result === "waiting") {
        // Проснуться нужно к ближайшему из двух сроков: конец окна накопления
        // или время следующей попытки отложенной записи
        const nextAt = this.holdUntil ?? this.db.getNextAnchorAttemptAt()
        if (nextAt !== undefined && nextAt !== null) {
          delay = Math.min(Math.max(nextAt - this.now(), 50), this.idleMs)
        }
      }
      await this.sleep(delay)
    }
  }

  private sleep(ms: number) {
    return new Promise<void>((resolve) => {
      const timer = setTimeout(() => {
        this.wake = null
        resolve()
      }, ms)
      this.wake = () => {
        clearTimeout(timer)
        this.wake = null
        resolve()
      }
    })
  }

  private kick() {
    this.wake?.()
  }

  private emit(event: AnchorEvent) {
    try {
      this.onEvent?.(event)
    } catch {
      // Ошибки слушателей не должны ронять воркер
    }
  }
}
