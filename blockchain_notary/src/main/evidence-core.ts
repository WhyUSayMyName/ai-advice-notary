import path from "node:path"
import type { ArtifactRecord } from "./database-core"

export type EvidenceArtifact = {
  artifact_id: string
  display_name: string
  version: number
  file_name: string
  file_path: string
  hash: string
  previous_hash: string | null
  notarized: boolean
  blockchain_tx: string | null
  created_at: number
}

export type EvidenceBundle = {
  format: "notary-evidence/v1"
  generated_at: string
  chain: {
    chain_id: number | null
    contract: string
    rpc_url_hint: string | null
  }
  artifacts: EvidenceArtifact[]
  verification: {
    tool: string
    steps: string[]
  }
}

export type ChainInfo = {
  contract: string
  chainId: number | null
  rpcUrl?: string
}

export function buildEvidenceBundle(records: ArtifactRecord[], chain: ChainInfo): EvidenceBundle {
  const artifacts: EvidenceArtifact[] = [...records]
    .sort((a, b) =>
      a.artifact_id === b.artifact_id
        ? a.version - b.version
        : a.artifact_id.localeCompare(b.artifact_id)
    )
    .map((r) => ({
      artifact_id: r.artifact_id,
      display_name: r.display_name,
      version: r.version,
      file_name: path.basename(r.file_path),
      file_path: r.file_path,
      hash: r.hash,
      previous_hash: r.previous_hash,
      notarized: Boolean(r.notarized),
      blockchain_tx: r.blockchain_tx,
      created_at: r.created_at,
    }))

  return {
    format: "notary-evidence/v1",
    generated_at: new Date().toISOString(),
    chain: {
      chain_id: chain.chainId,
      contract: chain.contract,
      rpc_url_hint: chain.rpcUrl ?? null,
    },
    artifacts,
    verification: {
      tool: "notary-verify (verifier-cli in https://github.com/WhyUSayMyName/ai-advice-notary)",
      steps: [
        "Obtain the contract address from a source you trust, not only from this file.",
        "Use a JSON-RPC node you control or trust (rpc_url_hint is a hint, not a guarantee).",
        "Run: notary-verify --bundle <this file> --dir <directory with the documents> --rpc <url>",
        "TAMPERED / MISSING_FILE / NOT_ON_CHAIN indicate integrity violations.",
      ],
    },
  }
}
