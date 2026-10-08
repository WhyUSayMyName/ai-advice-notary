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

export type AnchorBatch = {
  root: string
  /**
   * Реестр, в котором заякорен пакет (см. registry-core.ts); null — пакет
   * создан до учёта реестров, и где он лежит, база не знает.
   */
  registry: string | null
  tx_hash: string | null
  leaf_count: number
  created_at: number
  /** Голова цепи до этой эпохи; null у пакетов до появления связывания */
  prev_chain_root: string | null
  /** Голова цепи после этой эпохи — именно она заякорена on-chain */
  chain_root: string | null
  /** Файловые хеши, входящие в пакет. */
  members: string[]
}

/** Пакет без состава — для списков и обзорных экранов. */
export type AnchorBatchSummary = Omit<AnchorBatch, "members">

export type AnchorQueueItem = {
  id: number
  hash: string
  rpc_url: string | null
  /** Реестр, в котором хеш заякорен; null — ещё не заякорен или запись старше учёта реестров. */
  registry: string | null
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
    CREATE TABLE IF NOT EXISTS anchor_batches (
      root TEXT NOT NULL,
      -- Реестр (chainId + адрес контракта), где заякорен пакет; '' — пакет
      -- создан до учёта реестров. Пустая строка, а не NULL: колонка входит
      -- в первичный ключ, а NULL в нём уникальность не обеспечивает.
      registry TEXT NOT NULL DEFAULT '',
      tx_hash TEXT,
      leaf_count INTEGER NOT NULL,
      created_at INTEGER NOT NULL,
      -- Связывание эпох: prev_chain_root — голова цепи до этого пакета,
      -- chain_root — голова после него, она же уходит on-chain.
      -- NULL у пакетов, созданных до появления связывания: они заякорены
      -- голым корнем и продолжают проверяться прежним способом.
      prev_chain_root TEXT,
      chain_root TEXT,
      -- Тот же состав документов может быть заякорен в нескольких реестрах:
      -- корень совпадёт, а связка эпох у каждого реестра своя
      PRIMARY KEY (root, registry)
    );

    CREATE TABLE IF NOT EXISTS anchor_batch_members (
      root TEXT NOT NULL,
      hash TEXT NOT NULL,
      PRIMARY KEY (root, hash)
    );

    CREATE INDEX IF NOT EXISTS idx_batch_members_hash ON anchor_batch_members(hash);
  `)

  // Связывание эпох появилось позже: в существующих базах таблица уже создана,
  // и CREATE TABLE IF NOT EXISTS колонок не добавит
  ensureColumn(db, "anchor_batches", "prev_chain_root", "TEXT")
  ensureColumn(db, "anchor_batches", "chain_root", "TEXT")
  migrateBatchesToRegistry(db)

  // Реестр записи очереди проставляется воркером при фиксации;
  // у записей, подтверждённых до учёта реестров, он остаётся NULL
  ensureColumn(db, "anchor_queue", "registry", "TEXT")

  db.exec(`
    UPDATE artifacts
    SET display_name = file_path
    WHERE display_name = '' OR display_name IS NULL
  `)
}

/**
 * Учёт реестров. Раньше база не знала, в какой сети и каком контракте
 * заякорен пакет: после переключения на другую сеть аудит не нашёл бы там
 * ни одного прежнего документа и показал бы это как «нет в реестре» —
 * неотличимо от подмены. Первичный ключ становится (root, registry):
 * один и тот же состав можно заякорить в разных реестрах, а SQLite ключ
 * на месте не меняет, поэтому таблица пересоздаётся. Старые пакеты
 * получают пустой реестр; при запуске воркер находит их on-chain и
 * проставляет реестр (AnchorService.recover).
 */
function migrateBatchesToRegistry(db: Database.Database) {
  const columns = db.prepare(`PRAGMA table_info(anchor_batches)`).all() as Array<{ name: string }>
  if (columns.some((c) => c.name === "registry")) return

  db.transaction(() => {
    db.exec(`
      CREATE TABLE anchor_batches_migrated (
        root TEXT NOT NULL,
        registry TEXT NOT NULL DEFAULT '',
        tx_hash TEXT,
        leaf_count INTEGER NOT NULL,
        created_at INTEGER NOT NULL,
        prev_chain_root TEXT,
        chain_root TEXT,
        PRIMARY KEY (root, registry)
      );

      -- Порядок вставки сохраняет rowid-порядок: по нему разрешается
      -- очерёдность эпох с одинаковым created_at
      INSERT INTO anchor_batches_migrated
        (root, registry, tx_hash, leaf_count, created_at, prev_chain_root, chain_root)
      SELECT root, '', tx_hash, leaf_count, created_at, prev_chain_root, chain_root
      FROM anchor_batches
      ORDER BY rowid;

      DROP TABLE anchor_batches;
      ALTER TABLE anchor_batches_migrated RENAME TO anchor_batches;
    `)
  })()
}

/** В таблице пакетов неизвестный реестр — пустая строка (она входит в ключ). */
const regKey = (registry?: string | null) => registry ?? ""

const BATCH_COLUMNS = `
  root, NULLIF(registry, '') AS registry, tx_hash, leaf_count, created_at,
  prev_chain_root, chain_root
`

export function createDatabase(dbPath: string) {
  const db = new Database(dbPath)
  // WAL: базу одновременно открывают Electron-приложение и MCP-сервер;
  // busy_timeout вместо мгновенного SQLITE_BUSY при пересечении записей
  db.pragma("journal_mode = WAL")
  db.pragma("busy_timeout = 5000")
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
   *
   * @param at момент поступления. Передаётся сервисом, потому что окно
   *   накопления пакета сравнивает created_at с его собственными часами —
   *   два источника времени в одном расчёте дают неверный результат.
   * @param registry реестр, в котором хеш нужно заякорить. Если запись
   *   подтверждена в другом реестре (или до учёта реестров), она
   *   реактивируется: иначе после переключения сети документ навсегда
   *   числился бы «заякоренным», не будучи в текущем реестре. Повторной
   *   транзакции это не означает — воркер перед отправкой проверяет чейн.
   */
  function enqueueAnchor(
    hash: string,
    rpcUrl?: string,
    at?: number,
    registry?: string
  ): AnchorQueueItem {
    const now = at ?? Date.now()
    const existing = getAnchorByHash(hash)

    if (existing) {
      const anchoredElsewhere =
        registry !== undefined && existing.status === "confirmed" && existing.registry !== registry

      if (existing.status === "failed" || anchoredElsewhere) {
        db.prepare(`
          UPDATE anchor_queue
          SET status = 'pending', attempts = 0, next_attempt_at = 0,
              last_error = NULL, created_at = ?, updated_at = ?,
              rpc_url = COALESCE(?, rpc_url),
              tx_hash = CASE WHEN status = 'confirmed' THEN NULL ELSE tx_hash END,
              registry = CASE WHEN status = 'confirmed' THEN NULL ELSE registry END
          WHERE id = ?
        `).run(now, now, rpcUrl ?? null, existing.id)
        return getAnchorByHash(hash)!
      }
      return existing
    }

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
    return getDueAnchors(now, 1)[0]
  }

  /** Все созревшие pending-записи (для пакетной фиксации). */
  function getDueAnchors(now: number, limit = 256): AnchorQueueItem[] {
    return db
      .prepare(`
        SELECT * FROM anchor_queue
        WHERE status = 'pending' AND next_attempt_at <= ?
        ORDER BY id
        LIMIT ?
      `)
      .all(now, limit) as AnchorQueueItem[]
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

  function markAnchorSent(id: number, txHash: string, registry?: string) {
    db.prepare(`
      UPDATE anchor_queue
      SET status = 'sent', tx_hash = ?, registry = COALESCE(?, registry), updated_at = ?
      WHERE id = ?
    `).run(txHash, registry ?? null, Date.now(), id)
  }

  function markAnchorConfirmed(id: number, txHash?: string | null, registry?: string) {
    db.prepare(`
      UPDATE anchor_queue
      SET status = 'confirmed', tx_hash = COALESCE(?, tx_hash),
          registry = COALESCE(?, registry), last_error = NULL, updated_at = ?
      WHERE id = ?
    `).run(txHash ?? null, registry ?? null, Date.now(), id)
  }

  /** Подтверждённые записи без реестра — заякорены до учёта реестров. */
  function getUnassignedConfirmedAnchors(): AnchorQueueItem[] {
    return db
      .prepare(`SELECT * FROM anchor_queue WHERE status = 'confirmed' AND registry IS NULL ORDER BY id`)
      .all() as AnchorQueueItem[]
  }

  function setAnchorRegistry(id: number, registry: string) {
    db.prepare(`UPDATE anchor_queue SET registry = ? WHERE id = ?`).run(registry, id)
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

  // ---------- Пакеты фиксации (merkle batches) ----------

  function batchRow(root: string, registry?: string | null): AnchorBatch | undefined {
    const row = db
      .prepare(`SELECT ${BATCH_COLUMNS} FROM anchor_batches WHERE root = ? AND registry = ?`)
      .get(root, regKey(registry)) as Omit<AnchorBatch, "members"> | undefined
    if (!row) return undefined

    const members = (
      db.prepare(`SELECT hash FROM anchor_batch_members WHERE root = ? ORDER BY hash`).all(root) as Array<{ hash: string }>
    ).map((r) => r.hash)

    return { ...row, members }
  }

  /**
   * Регистрирует состав пакета до отправки транзакции (нужен для recovery).
   * link — связка с предыдущей эпохой; отсутствует только у пакетов,
   * созданных до появления связывания. registry — реестр, куда пакет уходит.
   */
  const createAnchorBatch = db.transaction(
    (
      root: string,
      hashes: string[],
      link?: { prevChainRoot: string; chainRoot: string },
      registry?: string
    ) => {
      db.prepare(`
        INSERT INTO anchor_batches
          (root, registry, tx_hash, leaf_count, created_at, prev_chain_root, chain_root)
        VALUES (?, ?, NULL, ?, ?, ?, ?)
        ON CONFLICT(root, registry) DO NOTHING
      `).run(
        root,
        regKey(registry),
        hashes.length,
        Date.now(),
        link?.prevChainRoot ?? null,
        link?.chainRoot ?? null
      )

      const insert = db.prepare(`
        INSERT OR IGNORE INTO anchor_batch_members (root, hash) VALUES (?, ?)
      `)
      for (const hash of hashes) insert.run(root, hash)
    }
  )

  /**
   * Голова цепи реестра — chain_root его последней связанной эпохи.
   * undefined, если связанных эпох ещё нет: значит цепь начинается с генезиса.
   * У каждого реестра цепь своя: звено, заякоренное в другой сети, аудитор
   * этого реестра проверить не может, и связка с ним была бы разрывом.
   */
  function getChainHead(registry?: string): string | undefined {
    const row = db
      .prepare(`
        SELECT chain_root
        FROM anchor_batches
        WHERE chain_root IS NOT NULL AND registry = ?
        ORDER BY created_at DESC, rowid DESC
        LIMIT 1
      `)
      .get(regKey(registry)) as { chain_root: string } | undefined

    return row?.chain_root
  }

  /** Звенья цепи реестра в хронологическом порядке — для проверки непрерывности. */
  function getChainLinks(
    registry?: string
  ): Array<{ prev: string; batchRoot: string; chainRoot: string }> {
    return (
      db
        .prepare(`
          SELECT prev_chain_root, root, chain_root
          FROM anchor_batches
          WHERE chain_root IS NOT NULL AND registry = ?
          ORDER BY created_at ASC, rowid ASC
        `)
        .all(regKey(registry)) as Array<{ prev_chain_root: string; root: string; chain_root: string }>
    ).map((r) => ({ prev: r.prev_chain_root, batchRoot: r.root, chainRoot: r.chain_root }))
  }

  function setAnchorBatchTx(root: string, txHash: string, registry?: string) {
    db.prepare(`UPDATE anchor_batches SET tx_hash = ? WHERE root = ? AND registry = ?`).run(
      txHash,
      root,
      regKey(registry)
    )
  }

  /** Откат пакета, отправка которого не состоялась. */
  const deleteAnchorBatch = db.transaction((root: string, registry?: string) => {
    db.prepare(`DELETE FROM anchor_batches WHERE root = ? AND registry = ?`).run(
      root,
      regKey(registry)
    )
    // Состав общий для всех реестров с тем же корнем — удаляется последним
    const stillUsed = db.prepare(`SELECT 1 FROM anchor_batches WHERE root = ?`).get(root)
    if (!stillUsed) db.prepare(`DELETE FROM anchor_batch_members WHERE root = ?`).run(root)
  })

  function getAnchorBatch(root: string, registry?: string | null): AnchorBatch | undefined {
    return batchRow(root, registry)
  }

  /**
   * Проставляет реестр пакету, созданному до учёта реестров. Если тот же
   * корень в этом реестре уже записан, старая строка просто уходит.
   */
  const assignBatchRegistry = db.transaction((root: string, registry: string) => {
    const taken = db
      .prepare(`SELECT 1 FROM anchor_batches WHERE root = ? AND registry = ?`)
      .get(root, registry)
    if (taken) {
      db.prepare(`DELETE FROM anchor_batches WHERE root = ? AND registry = ''`).run(root)
    } else {
      db.prepare(`UPDATE anchor_batches SET registry = ? WHERE root = ? AND registry = ''`).run(
        registry,
        root
      )
    }
  })

  /** Пакеты с транзакцией, но без реестра — кандидаты на сверку с чейном. */
  function getUnassignedBatches(): AnchorBatchSummary[] {
    return db
      .prepare(`
        SELECT ${BATCH_COLUMNS} FROM anchor_batches
        WHERE registry = '' AND tx_hash IS NOT NULL
        ORDER BY created_at ASC, rowid ASC
      `)
      .all() as AnchorBatchSummary[]
  }

  /**
   * Список пакетов, свежие первыми. Состав намеренно не загружается:
   * в пакете могут быть сотни хешей, а списку они не нужны.
   * С registry — только пакеты этого реестра и пакеты без реестра.
   */
  function listAnchorBatches(limit = 200, registry?: string): AnchorBatchSummary[] {
    const scoped = registry !== undefined
    return db
      .prepare(`
        SELECT ${BATCH_COLUMNS}
        FROM anchor_batches
        ${scoped ? "WHERE registry IN (?, '')" : ""}
        ORDER BY created_at DESC
        LIMIT ?
      `)
      .all(...(scoped ? [registry, limit] : [limit])) as AnchorBatchSummary[]
  }

  /**
   * Все пакеты, содержащие данный файловый хеш (свежие первыми).
   * С registry — только этого реестра и пакеты без реестра: последние могут
   * лежать где угодно, их проверяет чейн, а не база.
   */
  function getAnchorBatchesForHash(hash: string, registry?: string): AnchorBatch[] {
    const scoped = registry !== undefined
    const rows = db
      .prepare(`
        SELECT b.root, b.registry
        FROM anchor_batch_members m
        JOIN anchor_batches b ON b.root = m.root
        WHERE m.hash = ? ${scoped ? "AND b.registry IN (?, '')" : ""}
        ORDER BY b.created_at DESC, b.rowid DESC
      `)
      .all(...(scoped ? [hash, registry] : [hash])) as Array<{ root: string; registry: string }>

    return rows.map((r) => batchRow(r.root, r.registry)!).filter(Boolean)
  }

  /**
   * Реестры, в которых хеш числится заякоренным по данным базы: пакеты
   * с транзакцией и прямая фиксация из очереди. null в списке — фиксация
   * до учёта реестров, где она лежит, неизвестно.
   */
  function getAnchorRegistriesForHash(hash: string): Array<string | null> {
    const fromBatches = (
      db
        .prepare(`
          SELECT DISTINCT NULLIF(b.registry, '') AS registry
          FROM anchor_batch_members m
          JOIN anchor_batches b ON b.root = m.root
          WHERE m.hash = ? AND b.tx_hash IS NOT NULL
        `)
        .all(hash) as Array<{ registry: string | null }>
    ).map((r) => r.registry)

    const queued = getAnchorByHash(hash)
    const fromQueue = queued?.status === "confirmed" ? [queued.registry] : []

    return [...new Set([...fromBatches, ...fromQueue])]
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
    getDueAnchors,
    getNextAnchorAttemptAt,
    getUnconfirmedAnchors,
    markAnchorSent,
    markAnchorConfirmed,
    getUnassignedConfirmedAnchors,
    setAnchorRegistry,
    rescheduleAnchor,
    markAnchorFailed,
    createAnchorBatch,
    setAnchorBatchTx,
    deleteAnchorBatch,
    getAnchorBatch,
    getAnchorBatchesForHash,
    getAnchorRegistriesForHash,
    assignBatchRegistry,
    getUnassignedBatches,
    listAnchorBatches,
    getChainHead,
    getChainLinks,
    close: () => db.close(),
  }
}

export type NotaryDatabase = ReturnType<typeof createDatabase>
