import { getArtifacts } from "./database"
import { buildChainReports, type VersionChainReport } from "./version-chain-core"

export type {
  VersionChainStatus,
  VersionChainItem,
  VersionChainReport,
} from "./version-chain-core"

export function inspectVersionChains(): VersionChainReport[] {
  return buildChainReports(getArtifacts())
}
