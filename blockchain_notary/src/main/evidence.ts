import "dotenv/config"
import { getArtifacts, getDatabase } from "./database"
import { notaryChainId } from "./notary"
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

  return buildEvidenceBundle(
    getArtifacts(),
    { contract, chainId, rpcUrl },
    {
      // Свежайший пакет с известной транзакцией — именно он заякорен on-chain
      batchFor: (hash) =>
        getDatabase()
          .getAnchorBatchesForHash(hash)
          .find((b) => b.tx_hash !== null),
    }
  )
}
