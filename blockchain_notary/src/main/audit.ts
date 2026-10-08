import { access } from "node:fs/promises"
import { constants } from "node:fs"
import { sha256FileHex } from "./filehash"
import { getArtifacts, getDatabase } from "./database"
import { resolveAnchoredRecord } from "./artifacts"
import { notaryRegistry } from "./notary"
import { anchorScope } from "./registry-core"

export type AuditStatus =
  | "LOCAL_ONLY"
  | "ON_CHAIN_OK"
  | "MISSING_FILE"
  | "HASH_MISMATCH"
  | "ON_CHAIN_MISSING"
  // Заякорено только в других реестрах — в текущем проверять нечего
  | "OTHER_REGISTRY"
  // Фиксация до учёта реестров, в текущем не найдена: где она — неизвестно
  | "REGISTRY_UNKNOWN"

export type AuditResult = {
  id: number
  artifact_id: string
  file_path: string
  stored_hash: string
  current_hash: string | null
  blockchain_tx: string | null
  notarized: number
  created_at: number
  status: AuditStatus
  author?: string
  timestamp?: number
  /** Для OTHER_REGISTRY — реестры, где документ заякорен. */
  registries?: string[]
}

async function fileExists(filePath: string) {
  try {
    await access(filePath, constants.F_OK)
    return true
  } catch {
    return false
  }
}

/**
 * Аудит сверяет документы с реестром, к которому подключено приложение.
 * Отсутствие в реестре — тревога только для документов, заякоренных именно
 * в нём: после переключения сети прежние документы иначе выглядели бы
 * подменёнными, а ложная тревога в этой системе хуже молчания.
 */
export async function auditArtifacts(rpcUrl?: string): Promise<AuditResult[]> {
  const artifacts = getArtifacts()
  const registry = await notaryRegistry(rpcUrl)
  const db = getDatabase()
  const results: AuditResult[] = []

  for (const a of artifacts) {
    const base = {
      id: a.id,
      artifact_id: a.artifact_id,
      file_path: a.file_path,
      stored_hash: a.hash,
      blockchain_tx: a.blockchain_tx,
      notarized: a.notarized,
      created_at: a.created_at,
    }

    if (!(await fileExists(a.file_path))) {
      results.push({ ...base, current_hash: null, status: "MISSING_FILE" })
      continue
    }

    const currentHash = await sha256FileHex(a.file_path)

    if (currentHash !== a.hash) {
      results.push({ ...base, current_hash: currentHash, status: "HASH_MISMATCH" })
      continue
    }

    if (!a.notarized) {
      results.push({ ...base, current_hash: currentHash, status: "LOCAL_ONLY" })
      continue
    }

    const scope = anchorScope(db.getAnchorRegistriesForHash(a.hash), registry)
    if (scope.kind === "elsewhere") {
      results.push({
        ...base,
        current_hash: currentHash,
        status: "OTHER_REGISTRY",
        registries: scope.registries,
      })
      continue
    }

    // Batch-aware: фиксация могла быть одиночной или через корень merkle-пакета
    const record = await resolveAnchoredRecord(a.hash, rpcUrl)

    if (!record.exists) {
      results.push({
        ...base,
        current_hash: currentHash,
        status: scope.kind === "current" ? "ON_CHAIN_MISSING" : "REGISTRY_UNKNOWN",
      })
      continue
    }

    results.push({
      ...base,
      current_hash: currentHash,
      status: "ON_CHAIN_OK",
      author: record.author,
      timestamp: record.timestamp,
    })
  }

  return results
}
