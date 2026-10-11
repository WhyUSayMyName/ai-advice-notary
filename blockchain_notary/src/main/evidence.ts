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

  // Пакет описывает один реестр (chain_id + contract в заголовке), и по нему
  // отбираются документы. Без узла сеть не узнать, а пакет без отбора смешал
  // бы документы из разных сетей — аудитор получил бы ложные NOT_ON_CHAIN.
  // Поэтому без узла экспорт отказывает, а не выдаёт вводящий в заблуждение файл
  let chainId: number
  try {
    chainId = await notaryChainId(rpcUrl)
  } catch (e) {
    throw new Error(
      "Нет связи с узлом — не определить, к какой сети относится пакет. " +
        "Подключитесь к узлу и повторите экспорт. " +
        `(${e instanceof Error ? e.message : String(e)})`
    )
  }

  const registry = registryId(chainId, contract)
  const db = getDatabase()

  return buildEvidenceBundle(
    getArtifacts(),
    { contract, chainId, rpcUrl },
    {
      // Свежайший пакет этого реестра с известной транзакцией — именно он
      // заякорен on-chain там, куда пакет доказательств отправит аудитора
      batchFor: (hash) =>
        db.getAnchorBatchesForHash(hash, registry).find((b) => b.tx_hash !== null),
      registriesFor: (hash) => db.getAnchorRegistriesForHash(hash),
      registry,
    }
  )
}
