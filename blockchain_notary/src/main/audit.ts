import { access } from "node:fs/promises"
import { constants } from "node:fs"
import { sha256FileHex } from "./filehash"
import { getArtifacts } from "./database"
import { resolveAnchoredRecord } from "./artifacts"

export type AuditStatus =
  | "LOCAL_ONLY"
  | "ON_CHAIN_OK"
  | "MISSING_FILE"
  | "HASH_MISMATCH"
  | "ON_CHAIN_MISSING"

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
}

async function fileExists(filePath: string) {
  try {
    await access(filePath, constants.F_OK)
    return true
  } catch {
    return false
  }
}

export async function auditArtifacts(): Promise<AuditResult[]> {
  const artifacts = getArtifacts()
  const results: AuditResult[] = []

  for (const a of artifacts) {
    const exists = await fileExists(a.file_path)

    if (!exists) {
      results.push({
        id: a.id,
        artifact_id: a.artifact_id,
        file_path: a.file_path,
        stored_hash: a.hash,
        current_hash: null,
        blockchain_tx: a.blockchain_tx,
        notarized: a.notarized,
        created_at: a.created_at,
        status: "MISSING_FILE",
      })
      continue
    }

    const currentHash = await sha256FileHex(a.file_path)

    if (currentHash !== a.hash) {
      results.push({
        id: a.id,
        artifact_id: a.artifact_id,
        file_path: a.file_path,
        stored_hash: a.hash,
        current_hash: currentHash,
        blockchain_tx: a.blockchain_tx,
        notarized: a.notarized,
        created_at: a.created_at,
        status: "HASH_MISMATCH",
      })
      continue
    }

    if (!a.notarized) {
      results.push({
        id: a.id,
        artifact_id: a.artifact_id,
        file_path: a.file_path,
        stored_hash: a.hash,
        current_hash: currentHash,
        blockchain_tx: a.blockchain_tx,
        notarized: a.notarized,
        created_at: a.created_at,
        status: "LOCAL_ONLY",
      })
      continue
    }

    // Batch-aware: фиксация могла быть одиночной или через корень merkle-пакета
    const record = await resolveAnchoredRecord(a.hash)

    if (!record.exists) {
      results.push({
        id: a.id,
        artifact_id: a.artifact_id,
        file_path: a.file_path,
        stored_hash: a.hash,
        current_hash: currentHash,
        blockchain_tx: a.blockchain_tx,
        notarized: a.notarized,
        created_at: a.created_at,
        status: "ON_CHAIN_MISSING",
      })
      continue
    }

    results.push({
      id: a.id,
      artifact_id: a.artifact_id,
      file_path: a.file_path,
      stored_hash: a.hash,
      current_hash: currentHash,
      blockchain_tx: a.blockchain_tx,
      notarized: a.notarized,
      created_at: a.created_at,
      status: "ON_CHAIN_OK",
      author: record.author,
      timestamp: record.timestamp,
    })
  }

  return results
}