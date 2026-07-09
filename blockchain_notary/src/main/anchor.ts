import { getDatabase, markArtifactNotarized } from "./database"
import { notaryIsNotarized, notarySendNotarize } from "./notary"
import { AnchorService, type AnchorEvent } from "./anchor-service"

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
        isNotarized: async (hash, rpcUrl) => (await notaryIsNotarized(hash, rpcUrl)).notarized,
        sendNotarize: (hash, rpcUrl) => notarySendNotarize(hash, rpcUrl),
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

export function listAnchorQueue() {
  return getDatabase().getAnchorQueue()
}
