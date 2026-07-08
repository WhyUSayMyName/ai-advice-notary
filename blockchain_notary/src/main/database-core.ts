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
    close: () => db.close(),
  }
}

export type NotaryDatabase = ReturnType<typeof createDatabase>
