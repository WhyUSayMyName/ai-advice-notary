import Database from "better-sqlite3"
import path from "path"
import { app } from "electron"
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

let db: Database.Database | null = null

function getDb() {
  if (db) return db

  const dbPath = path.join(app.getPath("userData"), "notary.db")
  db = new Database(dbPath)

  db.exec(`
    CREATE TABLE IF NOT EXISTS artifacts (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      artifact_id TEXT NOT NULL,
      display_name TEXT NOT NULL,
      file_path TEXT NOT NULL,
      hash TEXT NOT NULL UNIQUE,
      version INTEGER NOT NULL DEFAULT 1,
      previous_hash TEXT,
      created_at INTEGER NOT NULL,
      blockchain_tx TEXT,
      notarized INTEGER NOT NULL DEFAULT 0
    );
  `)

  ensureColumn(db, "artifacts", "display_name", "TEXT NOT NULL DEFAULT ''")
  ensureColumn(db, "artifacts", "version", "INTEGER NOT NULL DEFAULT 1")
  ensureColumn(db, "artifacts", "previous_hash", "TEXT")

  db.exec(`
    CREATE INDEX IF NOT EXISTS idx_artifacts_artifact_id
    ON artifacts(artifact_id);

    CREATE INDEX IF NOT EXISTS idx_artifacts_hash
    ON artifacts(hash);
  `)

  db.exec(`
    UPDATE artifacts
    SET display_name = file_path
    WHERE display_name = '' OR display_name IS NULL
  `)

  return db
}

function ensureColumn(database: Database.Database, table: string, column: string, definition: string) {
  const columns = database.prepare(`PRAGMA table_info(${table})`).all() as Array<{ name: string }>
  const exists = columns.some((c) => c.name === column)

  if (!exists) {
    database.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${definition}`)
  }
}

export function createArtifact(filePath: string, hash: string, displayName?: string) {
  const database = getDb()
  const artifactId = crypto.randomUUID()
  const normalizedDisplayName = displayName?.trim() || filePath

  const stmt = database.prepare(`
    INSERT OR IGNORE INTO artifacts
    (artifact_id, display_name, file_path, hash, version, previous_hash, created_at, notarized)
    VALUES (?, ?, ?, ?, 1, NULL, ?, 0)
  `)

  stmt.run(
    artifactId,
    normalizedDisplayName,
    filePath,
    hash,
    Date.now()
  )

  return artifactId
}

export function createArtifactVersion(
  artifactId: string,
  filePath: string,
  hash: string,
  displayName?: string
) {
  const database = getDb()
  const latest = getLatestArtifactVersion(artifactId)

  if (!latest) {
    throw new Error(`Artifact not found: ${artifactId}`)
  }

  const normalizedDisplayName = displayName?.trim() || latest.display_name || filePath
  const nextVersion = latest.version + 1

  const stmt = database.prepare(`
    INSERT OR IGNORE INTO artifacts
    (artifact_id, display_name, file_path, hash, version, previous_hash, created_at, notarized)
    VALUES (?, ?, ?, ?, ?, ?, ?, 0)
  `)

  stmt.run(
    artifactId,
    normalizedDisplayName,
    filePath,
    hash,
    nextVersion,
    latest.hash,
    Date.now()
  )
}

export function upsertArtifact(filePath: string, hash: string, displayName?: string) {
  const database = getDb()

  const existing = database
    .prepare(`SELECT id FROM artifacts WHERE hash = ?`)
    .get(hash) as { id: number } | undefined

  if (existing) {
    database
      .prepare(`
        UPDATE artifacts
        SET file_path = ?,
            display_name = COALESCE(NULLIF(?, ''), display_name)
        WHERE hash = ?
      `)
      .run(filePath, displayName ?? "", hash)

    return
  }

  createArtifact(filePath, hash, displayName)
}

export function getArtifacts(): ArtifactRecord[] {
  const database = getDb()

  const stmt = database.prepare(`
    SELECT *
    FROM artifacts
    ORDER BY created_at DESC
  `)

  return stmt.all() as ArtifactRecord[]
}

export function getArtifactsGroupedLatest(): ArtifactRecord[] {
  const database = getDb()

  const stmt = database.prepare(`
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

  return stmt.all() as ArtifactRecord[]
}

export function getArtifactHistory(artifactId: string): ArtifactRecord[] {
  const database = getDb()

  const stmt = database.prepare(`
    SELECT *
    FROM artifacts
    WHERE artifact_id = ?
    ORDER BY version DESC
  `)

  return stmt.all(artifactId) as ArtifactRecord[]
}

export function getLatestArtifactVersion(artifactId: string): ArtifactRecord | undefined {
  const database = getDb()

  const stmt = database.prepare(`
    SELECT *
    FROM artifacts
    WHERE artifact_id = ?
    ORDER BY version DESC
    LIMIT 1
  `)

  return stmt.get(artifactId) as ArtifactRecord | undefined
}

export function getArtifactByHash(hash: string): ArtifactRecord | undefined {
  const database = getDb()

  const stmt = database.prepare(`
    SELECT *
    FROM artifacts
    WHERE hash = ?
  `)

  return stmt.get(hash) as ArtifactRecord | undefined
}

export function getArtifactByPath(filePath: string): ArtifactRecord | undefined {
  const database = getDb()

  const stmt = database.prepare(`
    SELECT *
    FROM artifacts
    WHERE file_path = ?
    ORDER BY created_at DESC
    LIMIT 1
  `)

  return stmt.get(filePath) as ArtifactRecord | undefined
}

export function markArtifactNotarized(hash: string, txHash: string) {
  const database = getDb()

  const stmt = database.prepare(`
    UPDATE artifacts
    SET notarized = 1,
        blockchain_tx = ?
    WHERE hash = ?
  `)

  stmt.run(txHash, hash)
}