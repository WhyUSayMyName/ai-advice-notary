import "dotenv/config"
import { getArtifacts, getDatabase } from "./database"
import { notaryChainId } from "./notary"
import { registryId } from "./registry-core"
import { buildEvidenceBundle, type EvidenceBundle } from "./evidence-core"

export async function exportEvidenceBundle(rpcUrl?: string): Promise<EvidenceBundle> {
  const contract = process.env.NOTARY_ADDRESS
  if (!contract) {
    throw new Error("Missing env: NOTARY_ADDRESS")
  }

  let chainId: number | null = null
  try {
    chainId = await notaryChainId(rpcUrl)
  } catch {
    // chainId — вспомогательная информация; недоступность узла не блокирует
    // экспорт: хеши и пруфы в бандле от сети не зависят
  }

  // Пакет описывает один реестр (chain_id + contract в заголовке). Без узла
  // реестр неизвестен — тогда отбор по реестру не делается, как и прежде
  const registry = chainId !== null ? registryId(chainId, contract) : undefined
  const db = getDatabase()

  return buildEvidenceBundle(
    getArtifacts(),
    { contract, chainId, rpcUrl },
    {
      // Свежайший пакет этого реестра с известной транзакцией — именно он
      // заякорен on-chain там, куда пакет доказательств отправит аудитора
      batchFor: (hash) =>
        db.getAnchorBatchesForHash(hash, registry).find((b) => b.tx_hash !== null),
      registriesFor: registry ? (hash) => db.getAnchorRegistriesForHash(hash) : undefined,
      registry,
    }
  )
}
