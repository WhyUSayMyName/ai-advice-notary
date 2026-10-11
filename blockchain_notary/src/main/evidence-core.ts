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

/**
 * Полного пути к файлу в пакете нет: пакет отдаётся постороннему, а путь —
 * это структура папок и имя учётной записи оператора. Верификатору хватает
 * file_name (он ищет файл в своём --dir), а file_path он никогда не читал,
 * поэтому поле убрано без смены версии формата: проверка старых и новых
 * пакетов от этого не меняется.
 */
export type EvidenceArtifact = {
  artifact_id: string
  display_name: string
  version: number
  file_name: string
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

/**
 * Подсказка аудитору, каким узлом пользовался оператор, — только схема и хост.
 *
 * Пакет уходит наружу, а у Alchemy и Infura ключ API зашит прямо в путь
 * (…/v2/<ключ>); в адресе бывают и логин с паролем. Целиком такой адрес унёс
 * бы секрет оператора к постороннему. Аудитору же нужен не узел оператора —
 * верификатор всё равно требует свой --rpc, — а лишь намёк на провайдера.
 */
export function rpcHint(rpcUrl?: string): string | null {
  if (!rpcUrl) return null
  try {
    const origin = new URL(rpcUrl).origin
    // У нестандартных схем origin — буквально строка "null"
    return origin === "null" ? null : origin
  } catch {
    return null
  }
}

/**
 * Имя документа для пакета. Человеческое имя («Паспорт БВР») идёт как есть.
 * Имя в виде абсолютного пути человек сам не выбирал: это либо старое имя
 * по умолчанию, либо баг, при котором новый файл получал путь открытого
 * в тот момент документа. В обоих случаях честное имя — имя собственного
 * файла документа, а путь постороннему ни к чему.
 */
function publicName(name: string, filePath: string): string {
  if (!/^([a-zA-Z]:[\\/]|[\\/])/.test(name)) return name
  return path.win32.basename(filePath) || name
}

export function buildEvidenceBundle(
  records: ArtifactRecord[],
  chain: ChainInfo,
  options: EvidenceOptions = {}
): EvidenceBundle {
  // Пакет описывает один реестр — тот, что в заголовке. Когда он известен,
  // в пакет попадает только заякоренное в нём. Документ из другой сети,
  // фиксация без записанного реестра или вовсе не фиксировавшийся файл
  // проверялись бы аудитором в этом реестре и получали NOT_ON_CHAIN —
  // ложное обвинение в подмене. Так и было в первом живом пакете Sepolia:
  // двадцать документов с давно остановленного локального узла. Фиксации
  // без реестра, которые на самом деле лежат здесь, recovery при старте
  // находит on-chain и помечает этим реестром — без реестра остаётся только
  // ненайденное. Пропуск безопаснее обвинения: пакет и не обещает полноты,
  // а в аудите приложения такие документы видны как REGISTRY_UNKNOWN.
  const registry = options.registry
  const registriesFor = options.registriesFor
  const scoped = registry !== undefined && registriesFor !== undefined
  const selected = scoped
    ? records.filter((r) => anchorScope(registriesFor(r.hash), registry).kind === "current")
    : records

  const artifacts: EvidenceArtifact[] = [...selected]
    .sort((a, b) =>
      a.artifact_id === b.artifact_id
        ? a.version - b.version
        : a.artifact_id.localeCompare(b.artifact_id)
    )
    .map((r) => {
      const entry: EvidenceArtifact = {
        artifact_id: r.artifact_id,
        display_name: publicName(r.display_name, r.file_path),
        version: r.version,
        // win32-разбор понимает оба разделителя: пакет с Windows-путями
        // собирается одинаково на любой ОС
        file_name: path.win32.basename(r.file_path),
        hash: r.hash,
        previous_hash: r.previous_hash,
        notarized: Boolean(r.notarized),
        blockchain_tx: r.blockchain_tx,
        created_at: r.created_at,
      }

      const batch = options.batchFor?.(r.hash)
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
      rpc_url_hint: rpcHint(chain.rpcUrl),
    },
    artifacts,
    verification: {
      tool: "notary-verify (verifier-cli in https://github.com/WhyUSayMyName/ai-advice-notary)",
      steps: [
        ...(scoped
          ? [
              "This bundle covers only documents anchored in the registry named in its header " +
                "(chain_id + contract). Documents anchored elsewhere or never anchored are not included.",
            ]
          : []),
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
