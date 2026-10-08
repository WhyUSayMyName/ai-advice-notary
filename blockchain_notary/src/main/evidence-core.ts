import path from "node:path"
import type { ArtifactRecord, AnchorBatch } from "./database-core"
import { buildMerkleTree } from "./merkle-core"
import { anchorScope } from "./registry-core"

export type EvidenceBatchProof = {
  /** Корень merkle-пакета. */
  root: string
  /** Транзакция anchorRoot (если известна). */
  tx: string | null
  /** Хеши-соседи от листа к корню (сортированные пары, префиксы 0x00/0x01, SHA-256). */
  proof: string[]
  /**
   * Голова цепи до этой эпохи. Вместе с root даёт заякоренное значение:
   * chain_root = SHA-256(0x02 ‖ prev_chain_root ‖ root).
   * Отсутствует у пакетов, созданных до появления связывания — тогда
   * on-chain лежит сам root.
   */
  prev_chain_root?: string
  /** Голова цепи после эпохи — именно это значение проверяется в реестре. */
  chain_root?: string
}

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
  /** Присутствует, если хеш зафиксирован в составе merkle-пакета. */
  batch?: EvidenceBatchProof
}

export type EvidenceBundle = {
  format: "notary-evidence/v3"
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

export type EvidenceOptions = {
  /** Пакет фиксации для хеша (свежайший с транзакцией) — из БД оператора. */
  batchFor?: (hash: string) => AnchorBatch | undefined
  /** Реестр пакета доказательств — тот, что описан в его заголовке. */
  registry?: string
  /** Реестры, в которых хеш числится заякоренным (см. getAnchorRegistriesForHash). */
  registriesFor?: (hash: string) => Array<string | null>
}

export function buildEvidenceBundle(
  records: ArtifactRecord[],
  chain: ChainInfo,
  options: EvidenceOptions = {}
): EvidenceBundle {
  const artifacts: EvidenceArtifact[] = [...records]
    .sort((a, b) =>
      a.artifact_id === b.artifact_id
        ? a.version - b.version
        : a.artifact_id.localeCompare(b.artifact_id)
    )
    .map((r) => {
      // notarized в пакете означает «заякорено в реестре из заголовка».
      // Документ, заякоренный только в другой сети, здесь не заякорен:
      // пометь его заякоренным — и аудитор получит NOT_ON_CHAIN, ложную
      // тревогу о подмене. Фиксации без учёта реестра остаются как были
      const elsewhere =
        options.registry !== undefined &&
        options.registriesFor !== undefined &&
        anchorScope(options.registriesFor(r.hash), options.registry).kind === "elsewhere"

      const entry: EvidenceArtifact = {
        artifact_id: r.artifact_id,
        display_name: r.display_name,
        version: r.version,
        file_name: path.basename(r.file_path),
        file_path: r.file_path,
        hash: r.hash,
        previous_hash: r.previous_hash,
        notarized: Boolean(r.notarized) && !elsewhere,
        blockchain_tx: r.blockchain_tx,
        created_at: r.created_at,
      }

      const batch = elsewhere ? undefined : options.batchFor?.(r.hash)
      if (batch) {
        // Proof пересчитывается из состава пакета в момент экспорта —
        // хранить его не нужно, канон дерева детерминирован
        entry.batch = {
          root: batch.root,
          tx: batch.tx_hash,
          proof: buildMerkleTree(batch.members).proofFor(r.hash),
          // Связка передаётся, только если эпоха связана: у старых пакетов
          // её нет, и верификатор проверяет сам корень
          ...(batch.chain_root && batch.prev_chain_root
            ? { prev_chain_root: batch.prev_chain_root, chain_root: batch.chain_root }
            : {}),
        }
      }

      return entry
    })

  return {
    format: "notary-evidence/v3",
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
        "Entries with a 'batch' block are anchored via a Merkle root: the verifier recomputes " +
          "the file hash and folds the proof to the root.",
        "When the batch carries prev_chain_root, epochs are linked: the anchored value is " +
          "chain_root = SHA-256(0x02 || prev_chain_root || root), and that is what is checked " +
          "on-chain. Without it the root itself is the anchored value (pre-linking batches).",
        "TAMPERED / MISSING_FILE / NOT_ON_CHAIN / BAD_PROOF / BAD_LINK indicate violations.",
      ],
    },
  }
}
