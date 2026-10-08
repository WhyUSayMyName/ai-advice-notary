import { getDatabase, markArtifactNotarized } from "./database"
import {
  notaryIsNotarized,
  notaryRegistry,
  notarySendAnchorRoot,
  notarySendNotarize,
} from "./notary"
import { AnchorService, type AnchorEvent } from "./anchor-service"
import { verifyChain } from "./chain-core"
import { buildMerkleTree } from "./merkle-core"
import type { CertificateBatch } from "./certificate"

let service: AnchorService | null = null
const listeners = new Set<(event: AnchorEvent) => void>()

/** Подписка на события очереди (electron/main.ts транслирует их в renderer). */
export function onAnchorEvent(listener: (event: AnchorEvent) => void) {
  listeners.add(listener)
  return () => listeners.delete(listener)
}

export function getAnchorService(): AnchorService {
  if (!service) {
    service = new AnchorService(
      getDatabase(),
      {
        registry: (rpcUrl) => notaryRegistry(rpcUrl),
        isNotarized: async (hash, rpcUrl) => (await notaryIsNotarized(hash, rpcUrl)).notarized,
        sendNotarize: (hash, rpcUrl) => notarySendNotarize(hash, rpcUrl),
        sendAnchorRoot: (root, leafCount, rpcUrl) =>
          notarySendAnchorRoot(root, leafCount, rpcUrl),
      },
      (hash, txHash) => markArtifactNotarized(hash, txHash ?? ""),
      (event) => {
        for (const l of listeners) l(event)
      }
    )
  }
  return service
}

/** Запуск при старте приложения: recovery + фоновый воркер. */
export async function startAnchorService() {
  const s = getAnchorService()
  const recovered = await s.recover()
  s.start()
  return recovered
}

/**
 * Останавливает фоновый воркер при завершении приложения.
 * Незавершённые записи остаются в очереди: recovery при следующем
 * запуске сверит их с чейном и дожмёт.
 */
export function stopAnchorService() {
  service?.stop()
}

/**
 * Отправить накопленное немедленно, не дожидаясь окна.
 * Возвращает момент, к которому пакет ушёл бы сам (для интерфейса).
 */
export function flushAnchorQueue() {
  const s = getAnchorService()
  s.flush()
  return { readyAt: s.batchReadyAt }
}

/** Когда придержанный пакет уйдёт сам; null — ничего не ждёт. */
export function anchorBatchReadyAt() {
  return service?.batchReadyAt ?? null
}

export function listAnchorQueue() {
  return getDatabase().getAnchorQueue()
}

/**
 * Пакеты фиксации — «эпохи» ствола: каждая закрыта одной транзакцией.
 * С registry — только эпохи этого реестра (и не размеченные старые).
 */
export function listAnchorBatches(registry?: string) {
  return getDatabase().listAnchorBatches(200, registry)
}

/**
 * Пакет, в составе которого зафиксирован хеш, вместе с merkle-путём до корня.
 * Нужен сертификату: при пакетной фиксации самого хеша в реестре нет,
 * и без пути документ не связать с заякоренным значением. Пакет берётся
 * из того реестра, который сертификат называет, — иначе связка эпох
 * указывала бы аудитору в другую сеть.
 */
export function anchorBatchForHash(hash: string, registry?: string): CertificateBatch | undefined {
  const batches = getDatabase().getAnchorBatchesForHash(hash, registry)
  // Один хеш может попасть в несколько пакетов при повторной фиксации —
  // берём самый ранний: именно он доказывает момент времени.
  const batch = batches[batches.length - 1]
  if (!batch) return undefined

  return {
    root: batch.root,
    leafCount: batch.leaf_count,
    proof: buildMerkleTree(batch.members).proofFor(hash),
    prevChainRoot: batch.prev_chain_root,
    chainRoot: batch.chain_root,
  }
}

/**
 * Проверяет непрерывность цепочки эпох по локальным данным.
 * Это самопроверка оператора: аудитор получает тот же вердикт независимо,
 * пересчитывая связки из пакета доказательств.
 */
export function verifyAnchorChain(registry?: string) {
  return verifyChain(getDatabase().getChainLinks(registry))
}
