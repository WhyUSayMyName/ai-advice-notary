import "dotenv/config"
import { JsonRpcProvider } from "ethers"
import { getArtifacts } from "./database"
import { buildEvidenceBundle, type EvidenceBundle } from "./evidence-core"

export async function exportEvidenceBundle(rpcUrl?: string): Promise<EvidenceBundle> {
  const contract = process.env.NOTARY_ADDRESS
  if (!contract) {
    throw new Error("Missing env: NOTARY_ADDRESS")
  }

  let chainId: number | null = null
  if (rpcUrl) {
    try {
      const net = await new JsonRpcProvider(rpcUrl).getNetwork()
      chainId = Number(net.chainId)
    } catch {
      // chainId — вспомогательная информация; недоступность узла не блокирует экспорт
    }
  }

  return buildEvidenceBundle(getArtifacts(), { contract, chainId, rpcUrl })
}
