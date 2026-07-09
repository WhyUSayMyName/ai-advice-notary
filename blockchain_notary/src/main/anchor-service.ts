import type { AnchorQueueItem, NotaryDatabase } from "./database-core"

/**
 * Адаптер взаимодействия с чейном. Выделен в интерфейс, чтобы сервис
 * можно было тестировать без узла и чтобы отправка была отделена
 * от ожидания подтверждения (важно для восстановления после сбоя).
 */
export type ChainAdapter = {
  isNotarized(hash: string, rpcUrl?: string): Promise<boolean>
  sendNotarize(
    hash: string,
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
  /** Часы — подменяются в тестах. */
  now?: () => number
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
  private readonly now: () => number

  private running = false
  private wake: (() => void) | null = null

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
    this.now = options.now ?? Date.now
  }

  /** Ставит хеш в очередь и будит воркер. Мгновенно, без сети. */
  enqueue(hash: string, rpcUrl?: string): AnchorQueueItem {
    const item = this.db.enqueueAnchor(hash, rpcUrl)
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

    for (const item of this.db.getUnconfirmedAnchors()) {
      try {
        const onChain = await this.chain.isNotarized(item.hash, item.rpc_url ?? undefined)

        if (onChain) {
          this.db.markAnchorConfirmed(item.id, item.tx_hash)
          this.onConfirmed(item.hash, item.tx_hash)
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
   * Обрабатывает одну запись очереди. Вынесено из цикла, чтобы тесты
   * могли шагать по очереди без таймеров и реального времени.
   */
  async processNext(): Promise<ProcessResult> {
    const item = this.db.getDueAnchor(this.now())

    if (!item) {
      return this.db.getNextAnchorAttemptAt() !== undefined ? "waiting" : "empty"
    }

    try {
      if (await this.chain.isNotarized(item.hash, item.rpc_url ?? undefined)) {
        this.db.markAnchorConfirmed(item.id, item.tx_hash)
        this.onConfirmed(item.hash, item.tx_hash)
        this.emit({ type: "confirmed", item: this.db.getAnchorByHash(item.hash)! })
        return "processed"
      }

      const { txHash, wait } = await this.chain.sendNotarize(
        item.hash,
        item.rpc_url ?? undefined
      )
      this.db.markAnchorSent(item.id, txHash)
      this.emit({ type: "sent", item: this.db.getAnchorByHash(item.hash)! })

      await wait()

      this.db.markAnchorConfirmed(item.id, txHash)
      this.onConfirmed(item.hash, txHash)
      this.emit({ type: "confirmed", item: this.db.getAnchorByHash(item.hash)! })
    } catch (e) {
      const message = e instanceof Error ? e.message : String(e)
      const attempts = item.attempts + 1

      if (attempts >= this.maxAttempts) {
        this.db.markAnchorFailed(item.id, attempts, message)
        this.emit({ type: "failed", item: this.db.getAnchorByHash(item.hash)! })
      } else {
        const backoff = Math.min(
          this.backoffBaseMs * 2 ** (attempts - 1),
          this.backoffMaxMs
        )
        this.db.rescheduleAnchor(item.id, attempts, this.now() + backoff, message)
        this.emit({ type: "retry", item: this.db.getAnchorByHash(item.hash)! })
      }
    }

    return "processed"
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
        const nextAt = this.db.getNextAnchorAttemptAt()
        if (nextAt !== undefined) {
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
