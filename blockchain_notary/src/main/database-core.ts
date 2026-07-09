import Database from "better-sqlite3"
import crypto from "node:crypto"

export type ArtifactRecord = {
  id: number
  artifact_id: string
  display_name: string
  file_path: string
  hash: string
  version: number
  previous_hash: string | null
  created_at: number
  blockchain_tx: string | null
  notarized: number
}

/** Контент новой версии совпал с одной из предыдущих версий этого артефакта. */
export class HashConflictError extends Error {
  readonly conflictVersion: number

  constructor(message: string, conflictVersion: number) {
    super(message)
    this.name = "HashConflictError"
    this.conflictVersion = conflictVersion
  }
}

export type CreateVersionResult = {
  /** true — контент не изменился относительно последней версии, новая запись не создана */
  unchanged: boolean
  record: ArtifactRecord
}

export type AnchorStatus = "pending" | "sent" | "confirmed" | "failed"

export type AnchorQueueItem = {
  id: number
  hash: string
  rpc_url: string | null
  status: AnchorStatus
  attempts: number
  next_attempt_at: number
  tx_hash: string | null
  last_error: string | null
  created_at: number
  updated_at: number
}

const NEW_SCHEMA = `
  CREATE TABLE IF NOT EXISTS artifacts (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    artifact_id TEXT NOT NULL,
    display_name TEXT NOT NULL DEFAULT '',
    file_path TEXT NOT NULL,
    hash TEXT NOT NULL,
    version INTEGER NOT NULL DEFAULT 1,
    previous_hash TEXT,
    created_at INTEGER NOT NULL,
    blockchain_tx TEXT,
    notarized INTEGER NOT NULL DEFAULT 0,
    UNIQUE (artifact_id, hash)
  )
`

function ensureColumn(db: Database.Database, table: string, column: string, definition: string) {
  const columns = db.prepare(`PRAGMA table_info(${table})`).all() as Array<{ name: string }>
  if (!columns.some((c) => c.name === column)) {
    db.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${definition}`)
  }
}

/**
 * Старая схема объявляла hash глобально уникальным, из-за чего два разных
 * артефакта не могли иметь одинаковое содержимое, а конфликт вставки молча
 * гасился INSERT OR IGNORE. Теперь уникальность — в рамках артефакта:
 * UNIQUE(artifact_id, hash). SQLite не умеет менять constraints, поэтому
 * старая таблица пересоздаётся с переносом данных.
 */
function migrate(db: Database.Database) {
  const tableSql = (
    db
      .prepare(`SELECT sql FROM sqlite_master WHERE type = 'table' AND name = 'artifacts'`)
      .get() as { sql: string } | undefined
  )?.sql

  if (!tableSql) {
    db.exec(NEW_SCHEMA)
  } else if (/hash\s+TEXT\s+NOT\s+NULL\s+UNIQUE/i.test(tableSql)) {
    // Колонки, добавлявшиеся поздними версиями приложения, могли отсутствовать
    ensureColumn(db, "artifacts", "display_name", "TEXT NOT NULL DEFAULT ''")
    ensureColumn(db, "artifacts", "version", "INTEGER NOT NULL DEFAULT 1")
    ensureColumn(db, "artifacts", "previous_hash", "TEXT")

    db.transaction(() => {
      db.exec(`
        CREATE TABLE artifacts_migrated (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          artifact_id TEXT NOT NULL,
          display_name TEXT NOT NULL DEFAULT '',
          file_path TEXT NOT NULL,
          hash TEXT NOT NULL,
          version INTEGER NOT NULL DEFAULT 1,
          previous_hash TEXT,
          created_at INTEGER NOT NULL,
          blockchain_tx TEXT,
          notarized INTEGER NOT NULL DEFAULT 0,
          UNIQUE (artifact_id, hash)
        );

        INSERT INTO artifacts_migrated
          (id, artifact_id, display_name, file_path, hash, version,
           previous_hash, created_at, blockchain_tx, notarized)
        SELECT
          id, artifact_id, COALESCE(display_name, ''), file_path, hash, COALESCE(version, 1),
          previous_hash, created_at, blockchain_tx, notarized
        FROM artifacts;

        DROP TABLE artifacts;
        ALTER TABLE artifacts_migrated RENAME TO artifacts;
      `)
    })()
  }

  db.exec(`
    CREATE INDEX IF NOT EXISTS idx_artifacts_artifact_id ON artifacts(artifact_id);
    CREATE INDEX IF NOT EXISTS idx_artifacts_hash ON artifacts(hash);
  `)

  db.exec(`
    CREATE TABLE IF NOT EXISTS anchor_queue (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      hash TEXT NOT NULL UNIQUE,
      rpc_url TEXT,
      status TEXT NOT NULL DEFAULT 'pending',
      attempts INTEGER NOT NULL DEFAULT 0,
      next_attempt_at INTEGER NOT NULL DEFAULT 0,
      tx_hash TEXT,
      last_error TEXT,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL
    );

    CREATE INDEX IF NOT EXISTS idx_anchor_queue_status ON anchor_queue(status, next_attempt_at);
  `)

  db.exec(`
    UPDATE artifacts
    SET display_name = file_path
    WHERE display_name = '' OR display_name IS NULL
  `)
}

export function createDatabase(dbPath: string) {
  const db = new Database(dbPath)
  migrate(db)

  function getArtifacts(): ArtifactRecord[] {
    return db
      .prepare(`SELECT * FROM artifacts ORDER BY created_at DESC`)
      .all() as ArtifactRecord[]
  }

  function getArtifactsGroupedLatest(): ArtifactRecord[] {
    return db
      .prepare(`
        SELECT a.*
        FROM artifacts a
        INNER JOIN (
          SELECT artifact_id, MAX(version) AS max_version
          FROM artifacts
          GROUP BY artifact_id
        ) latest
          ON a.artifact_id = latest.artifact_id
         AND a.version = latest.max_version
        ORDER BY a.created_at DESC
      `)
      .all() as ArtifactRecord[]
  }

  function getArtifactHistory(artifactId: string): ArtifactRecord[] {
    return db
      .prepare(`SELECT * FROM artifacts WHERE artifact_id = ? ORDER BY version DESC`)
      .all(artifactId) as ArtifactRecord[]
  }

  function getLatestArtifactVersion(artifactId: string): ArtifactRecord | undefined {
    return db
      .prepare(`SELECT * FROM artifacts WHERE artifact_id = ? ORDER BY version DESC LIMIT 1`)
      .get(artifactId) as ArtifactRecord | undefined
  }

  function getArtifactByHash(hash: string): ArtifactRecord | undefined {
    // Одинаковый контент может числиться в нескольких артефактах — берём свежайший
    return db
      .prepare(`SELECT * FROM artifacts WHERE hash = ? ORDER BY created_at DESC, id DESC LIMIT 1`)
      .get(hash) as ArtifactRecord | undefined
  }

  function getArtifactByPath(filePath: string): ArtifactRecord | undefined {
    return db
      .prepare(`SELECT * FROM artifacts WHERE file_path = ? ORDER BY created_at DESC LIMIT 1`)
      .get(filePath) as ArtifactRecord | undefined
  }

  function createArtifact(filePath: string, hash: string, displayName?: string): string {
    const artifactId = crypto.randomUUID()
    const normalizedDisplayName = displayName?.trim() || filePath

    db.prepare(`
      INSERT INTO artifacts
        (artifact_id, display_name, file_path, hash, version, previous_hash, created_at, notarized)
      VALUES (?, ?, ?, ?, 1, NULL, ?, 0)
    `).run(artifactId, normalizedDisplayName, filePath, hash, Date.now())

    return artifactId
  }

  const createArtifactVersionTx = db.transaction(
    (artifactId: string, filePath: string, hash: string, displayName?: string): CreateVersionResult => {
      const latest = getLatestArtifactVersion(artifactId)
      if (!latest) {
        throw new Error(`Артефакт не найден: ${artifactId}`)
      }

      const sameContent = db
        .prepare(`SELECT * FROM artifacts WHERE artifact_id = ? AND hash = ?`)
        .get(artifactId, hash) as ArtifactRecord | undefined

      if (sameContent) {
        if (sameContent.version === latest.version) {
          return { unchanged: true, record: sameContent }
        }
        throw new HashConflictError(
          `Содержимое файла байт-в-байт совпадает с версией ${sameContent.version} этого документа — ` +
            `новая версия не создана`,
          sameContent.version
        )
      }

      const normalizedDisplayName = displayName?.trim() || latest.display_name || filePath

      const info = db
        .prepare(`
          INSERT INTO artifacts
            (artifact_id, display_name, file_path, hash, version, previous_hash, created_at, notarized)
          VALUES (?, ?, ?, ?, ?, ?, ?, 0)
        `)
        .run(
          artifactId,
          normalizedDisplayName,
          filePath,
          hash,
          latest.version + 1,
          latest.hash,
          Date.now()
        )

      const record = db
        .prepare(`SELECT * FROM artifacts WHERE id = ?`)
        .get(info.lastInsertRowid) as ArtifactRecord

      return { unchanged: false, record }
    }
  )

  function createArtifactVersion(
    artifactId: string,
    filePath: string,
    hash: string,
    displayName?: string
  ): CreateVersionResult {
    return createArtifactVersionTx(artifactId, filePath, hash, displayName)
  }

  function upsertArtifact(filePath: string, hash: string, displayName?: string): string {
    const existing = getArtifactByHash(hash)

    if (existing) {
      db.prepare(`
        UPDATE artifacts
        SET file_path = ?,
            display_name = COALESCE(NULLIF(?, ''), display_name)
        WHERE id = ?
      `).run(filePath, displayName ?? "", existing.id)

      return existing.artifact_id
    }

    return createArtifact(filePath, hash, displayName)
  }

  function markArtifactNotarized(hash: string, txHash: string) {
    // Контент нотаризован on-chain независимо от того, в скольких артефактах он числится
    db.prepare(`
      UPDATE artifacts
      SET notarized = 1,
          blockchain_tx = ?
      WHERE hash = ?
    `).run(txHash, hash)
  }

  // ---------- Очередь фиксации (anchor queue) ----------

  function getAnchorByHash(hash: string): AnchorQueueItem | undefined {
    return db
      .prepare(`SELECT * FROM anchor_queue WHERE hash = ?`)
      .get(hash) as AnchorQueueItem | undefined
  }

  function getAnchorQueue(): AnchorQueueItem[] {
    return db
      .prepare(`SELECT * FROM anchor_queue ORDER BY id`)
      .all() as AnchorQueueItem[]
  }

  /**
   * Ставит хеш в очередь фиксации. Один хеш — одна запись:
   * повторная постановка возвращает существующую, а окончательно
   * проваленная (failed) реактивируется для новой серии попыток.
   */
  function enqueueAnchor(hash: string, rpcUrl?: string): AnchorQueueItem {
    const existing = getAnchorByHash(hash)

    if (existing) {
      if (existing.status === "failed") {
        db.prepare(`
          UPDATE anchor_queue
          SET status = 'pending', attempts = 0, next_attempt_at = 0,
              last_error = NULL, updated_at = ?
          WHERE id = ?
        `).run(Date.now(), existing.id)
        return getAnchorByHash(hash)!
      }
      return existing
    }

    const now = Date.now()
    const info = db
      .prepare(`
        INSERT INTO anchor_queue (hash, rpc_url, status, attempts, next_attempt_at, created_at, updated_at)
        VALUES (?, ?, 'pending', 0, 0, ?, ?)
      `)
      .run(hash, rpcUrl ?? null, now, now)

    return db
      .prepare(`SELECT * FROM anchor_queue WHERE id = ?`)
      .get(info.lastInsertRowid) as AnchorQueueItem
  }

  /** Следующая pending-запись, чей срок попытки наступил. */
  function getDueAnchor(now: number): AnchorQueueItem | undefined {
    return db
      .prepare(`
        SELECT * FROM anchor_queue
        WHERE status = 'pending' AND next_attempt_at <= ?
        ORDER BY id
        LIMIT 1
      `)
      .get(now) as AnchorQueueItem | undefined
  }

  /** Ближайший срок следующей попытки среди pending (или undefined). */
  function getNextAnchorAttemptAt(): number | undefined {
    const row = db
      .prepare(`SELECT MIN(next_attempt_at) AS t FROM anchor_queue WHERE status = 'pending'`)
      .get() as { t: number | null }
    return row.t ?? undefined
  }

  /** Все незавершённые записи (pending/sent) — для recovery при старте. */
  function getUnconfirmedAnchors(): AnchorQueueItem[] {
    return db
      .prepare(`SELECT * FROM anchor_queue WHERE status IN ('pending', 'sent') ORDER BY id`)
      .all() as AnchorQueueItem[]
  }

  function markAnchorSent(id: number, txHash: string) {
    db.prepare(`
      UPDATE anchor_queue SET status = 'sent', tx_hash = ?, updated_at = ? WHERE id = ?
    `).run(txHash, Date.now(), id)
  }

  function markAnchorConfirmed(id: number, txHash?: string | null) {
    db.prepare(`
      UPDATE anchor_queue
      SET status = 'confirmed', tx_hash = COALESCE(?, tx_hash), last_error = NULL, updated_at = ?
      WHERE id = ?
    `).run(txHash ?? null, Date.now(), id)
  }

  /** Неудачная попытка: вернуть в pending с новым сроком. */
  function rescheduleAnchor(id: number, attempts: number, nextAttemptAt: number, error: string) {
    db.prepare(`
      UPDATE anchor_queue
      SET status = 'pending', attempts = ?, next_attempt_at = ?, last_error = ?, updated_at = ?
      WHERE id = ?
    `).run(attempts, nextAttemptAt, error, Date.now(), id)
  }

  /** Лимит попыток исчерпан. */
  function markAnchorFailed(id: number, attempts: number, error: string) {
    db.prepare(`
      UPDATE anchor_queue
      SET status = 'failed', attempts = ?, last_error = ?, updated_at = ?
      WHERE id = ?
    `).run(attempts, error, Date.now(), id)
  }

  return {
    getArtifacts,
    getArtifactsGroupedLatest,
    getArtifactHistory,
    getLatestArtifactVersion,
    getArtifactByHash,
    getArtifactByPath,
    createArtifact,
    createArtifactVersion,
    upsertArtifact,
    markArtifactNotarized,
    getAnchorByHash,
    getAnchorQueue,
    enqueueAnchor,
    getDueAnchor,
    getNextAnchorAttemptAt,
    getUnconfirmedAnchors,
    markAnchorSent,
    markAnchorConfirmed,
    rescheduleAnchor,
    markAnchorFailed,
    close: () => db.close(),
  }
}

export type NotaryDatabase = ReturnType<typeof createDatabase>
