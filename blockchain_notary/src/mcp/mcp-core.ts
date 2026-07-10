import fs from "node:fs"
import os from "node:os"
import path from "node:path"
import type { AnchorQueueItem, NotaryDatabase } from "../main/database-core"
import { canonicalizeDialog, newSalt, type DialogInput } from "../main/dialog-canon"
import {
  canonicalizeAttestation,
  type AttestationVerdict,
} from "../main/attestation-canon"
import { sha256FileHex } from "../main/filehash"

/**
 * Ядро MCP-сервера: диалог/аттестация → канонический файл → артефакт → очередь.
 *
 * Ключевое решение: канонизированный диалог СТАНОВИТСЯ файлом. Дальше он
 * неотличим от любого другого документа — версии, очередь, merkle-батчи,
 * evidence bundle и CLI-верификатор работают с ним без единого изменения.
 */

export type McpDeps = {
  db: NotaryDatabase
  /** Постановка хеша в очередь якорения (AnchorService.enqueue или db.enqueueAnchor). */
  enqueue: (hash: string) => AnchorQueueItem
  /** Каталог, куда складываются канонические файлы диалогов и аттестаций. */
  artifactsDir: string
}

/**
 * Путь к базе, общей с Electron-приложением: то же расположение, что
 * app.getPath("userData") для приложения с именем blockchain_notary.
 */
export function resolveSharedDbPath(): string {
  if (process.env.NOTARY_DB_PATH) return process.env.NOTARY_DB_PATH

  const home = os.homedir()
  const base =
    process.platform === "win32"
      ? process.env.APPDATA ?? path.join(home, "AppData", "Roaming")
      : process.platform === "darwin"
        ? path.join(home, "Library", "Application Support")
        : process.env.XDG_CONFIG_HOME ?? path.join(home, ".config")

  return path.join(base, "blockchain_notary", "notary.db")
}

export function defaultArtifactsDir(dbPath: string): string {
  return path.join(path.dirname(dbPath), "llm-artifacts")
}

function writeCanonicalFile(
  dir: string,
  kind: "dialog" | "attestation",
  hash: string,
  canonical: string
): string {
  fs.mkdirSync(dir, { recursive: true })
  const stamp = new Date().toISOString().replace(/[:.]/g, "-")
  const filePath = path.join(dir, `${kind}_${stamp}_${hash.slice(2, 10)}.json`)
  fs.writeFileSync(filePath, canonical, "utf8")
  return filePath
}

export type NotarizeDialogResult = {
  hash: string
  salt: string
  file_path: string
  queue_status: string
  display_name: string
}

export function notarizeDialog(deps: McpDeps, input: DialogInput): NotarizeDialogResult {
  const { canonical, hash, salt } = canonicalizeDialog(input, newSalt())

  const existing = deps.db.getArtifactByHash(hash)
  if (existing) {
    // Тот же диалог уже фиксировался — идемпотентность, как у файлов
    const item = deps.enqueue(hash)
    return {
      hash,
      salt: "(уже зафиксирован ранее)",
      file_path: existing.file_path,
      queue_status: item.status,
      display_name: existing.display_name,
    }
  }

  const filePath = writeCanonicalFile(deps.artifactsDir, "dialog", hash, canonical)
  const displayName = `LLM-диалог ${input.provider}/${input.model} ${new Date().toISOString().slice(0, 10)}`

  deps.db.createArtifact(filePath, hash, displayName)
  const item = deps.enqueue(hash)

  return { hash, salt, file_path: filePath, queue_status: item.status, display_name: displayName }
}

export type AttestDecisionInput = {
  attestor: string
  verdict: AttestationVerdict
  dialog_hashes: string[]
  /** Путь к документу-решению: будет захеширован и зафиксирован вместе с актом. */
  document_path?: string
  comment?: string
}

export type AttestDecisionResult = {
  hash: string
  file_path: string
  queue_status: string
  document_hash?: string
  attested_at: string
  warnings: string[]
}

export async function attestDecision(
  deps: McpDeps,
  input: AttestDecisionInput
): Promise<AttestDecisionResult> {
  const warnings: string[] = []

  // Аттестация должна ссылаться на реально зафиксированные диалоги —
  // иначе цепочка ответственности рвётся в самом начале
  for (const h of input.dialog_hashes) {
    if (!deps.db.getArtifactByHash(h)) {
      warnings.push(
        `Диалог ${h.slice(0, 10)}… не найден в локальном реестре — ссылка останется, но проверьте хеш`
      )
    }
  }

  let documentHash: string | undefined
  if (input.document_path) {
    documentHash = await sha256FileHex(input.document_path)
    if (!deps.db.getArtifactByHash(documentHash)) {
      deps.db.createArtifact(
        input.document_path,
        documentHash,
        `Решение: ${path.basename(input.document_path)}`
      )
    }
    deps.enqueue(documentHash)
  }

  const attestedAt = new Date().toISOString()
  const { canonical, hash } = canonicalizeAttestation({
    attestor: input.attestor,
    verdict: input.verdict,
    dialog_hashes: input.dialog_hashes,
    document_hash: documentHash,
    comment: input.comment,
    attested_at: attestedAt,
  })

  const filePath = writeCanonicalFile(deps.artifactsDir, "attestation", hash, canonical)
  deps.db.createArtifact(
    filePath,
    hash,
    `Аттестация ${input.attestor} (${input.verdict}) ${attestedAt.slice(0, 10)}`
  )
  const item = deps.enqueue(hash)

  return {
    hash,
    file_path: filePath,
    queue_status: item.status,
    document_hash: documentHash,
    attested_at: attestedAt,
    warnings,
  }
}
