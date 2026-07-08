import { describe, it, expect, beforeEach, afterEach } from "vitest"
import Database from "better-sqlite3"
import fs from "node:fs"
import os from "node:os"
import path from "node:path"
import {
  createDatabase,
  HashConflictError,
  type NotaryDatabase,
} from "../database-core"

const H = (n: number) => "0x" + String(n).padStart(64, "0")

describe("database-core", () => {
  let db: NotaryDatabase

  beforeEach(() => {
    db = createDatabase(":memory:")
  })

  afterEach(() => {
    db.close()
  })

  it("создаёт артефакт с версией 1 без previous_hash", () => {
    const id = db.createArtifact("C:/docs/a.pdf", H(1), "Журнал ТБ")
    const latest = db.getLatestArtifactVersion(id)

    expect(latest).toBeDefined()
    expect(latest!.version).toBe(1)
    expect(latest!.previous_hash).toBeNull()
    expect(latest!.display_name).toBe("Журнал ТБ")
    expect(latest!.notarized).toBe(0)
  })

  it("наращивает версии и связывает их через previous_hash", () => {
    const id = db.createArtifact("C:/docs/a.pdf", H(1))

    const v2 = db.createArtifactVersion(id, "C:/docs/a.pdf", H(2))
    const v3 = db.createArtifactVersion(id, "C:/docs/a.pdf", H(3))

    expect(v2.unchanged).toBe(false)
    expect(v2.record.version).toBe(2)
    expect(v2.record.previous_hash).toBe(H(1))
    expect(v3.record.version).toBe(3)
    expect(v3.record.previous_hash).toBe(H(2))
    expect(db.getArtifactHistory(id)).toHaveLength(3)
  })

  it("контент, совпадающий с последней версией — unchanged, без новой записи", () => {
    const id = db.createArtifact("C:/docs/a.pdf", H(1))
    db.createArtifactVersion(id, "C:/docs/a.pdf", H(2))

    const res = db.createArtifactVersion(id, "C:/docs/a.pdf", H(2))

    expect(res.unchanged).toBe(true)
    expect(res.record.version).toBe(2)
    expect(db.getArtifactHistory(id)).toHaveLength(2)
  })

  it("контент, совпадающий со СТАРОЙ версией — явная ошибка с номером версии", () => {
    const id = db.createArtifact("C:/docs/a.pdf", H(1))
    db.createArtifactVersion(id, "C:/docs/a.pdf", H(2))

    expect(() => db.createArtifactVersion(id, "C:/docs/a.pdf", H(1))).toThrowError(
      HashConflictError
    )

    try {
      db.createArtifactVersion(id, "C:/docs/a.pdf", H(1))
    } catch (e) {
      expect(e).toBeInstanceOf(HashConflictError)
      expect((e as HashConflictError).conflictVersion).toBe(1)
      expect((e as HashConflictError).message).toContain("версией 1")
    }

    // после ошибки цепочка не повреждена
    expect(db.getArtifactHistory(id)).toHaveLength(2)
    expect(db.getLatestArtifactVersion(id)!.version).toBe(2)
  })

  it("одинаковый контент в РАЗНЫХ артефактах разрешён", () => {
    const a = db.createArtifact("C:/docs/a.pdf", H(1), "Журнал A")
    const b = db.createArtifact("C:/docs/b.pdf", H(1), "Журнал B")

    expect(a).not.toBe(b)

    const all = db.getArtifacts().filter((r) => r.hash === H(1))
    expect(all).toHaveLength(2)
  })

  it("версия для несуществующего артефакта — ошибка", () => {
    expect(() =>
      db.createArtifactVersion("no-such-id", "C:/docs/a.pdf", H(1))
    ).toThrowError(/не найден/)
  })

  it("markArtifactNotarized помечает все копии контента", () => {
    db.createArtifact("C:/docs/a.pdf", H(1))
    db.createArtifact("C:/docs/b.pdf", H(1))

    db.markArtifactNotarized(H(1), "0xTX")

    const marked = db.getArtifacts().filter((r) => r.hash === H(1))
    expect(marked).toHaveLength(2)
    for (const r of marked) {
      expect(r.notarized).toBe(1)
      expect(r.blockchain_tx).toBe("0xTX")
    }
  })

  it("getArtifactsGroupedLatest возвращает только последние версии", () => {
    const id = db.createArtifact("C:/docs/a.pdf", H(1))
    db.createArtifactVersion(id, "C:/docs/a.pdf", H(2))
    db.createArtifact("C:/docs/b.pdf", H(10))

    const grouped = db.getArtifactsGroupedLatest()

    expect(grouped).toHaveLength(2)
    const forA = grouped.find((r) => r.artifact_id === id)
    expect(forA!.version).toBe(2)
  })

  it("upsertArtifact обновляет путь существующей записи, не создавая дубликат", () => {
    const id = db.createArtifact("C:/docs/old-path.pdf", H(1))

    const sameId = db.upsertArtifact("C:/docs/new-path.pdf", H(1))

    expect(sameId).toBe(id)
    expect(db.getArtifacts()).toHaveLength(1)
    expect(db.getArtifactByHash(H(1))!.file_path).toBe("C:/docs/new-path.pdf")
  })
})

describe("миграция со старой схемы (глобальный UNIQUE hash)", () => {
  let dir: string
  let dbPath: string

  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), "notary-test-"))
    dbPath = path.join(dir, "notary.db")

    // Создаём БД в точности со старой схемой приложения
    const legacy = new Database(dbPath)
    legacy.exec(`
      CREATE TABLE artifacts (
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
    legacy
      .prepare(`
        INSERT INTO artifacts
          (artifact_id, display_name, file_path, hash, version, previous_hash, created_at, blockchain_tx, notarized)
        VALUES
          ('art-1', 'Doc', 'C:/docs/a.pdf', '${H(1)}', 1, NULL, 1000, '0xTX', 1),
          ('art-1', 'Doc', 'C:/docs/a.pdf', '${H(2)}', 2, '${H(1)}', 2000, NULL, 0)
      `)
      .run()
    legacy.close()
  })

  afterEach(() => {
    fs.rmSync(dir, { recursive: true, force: true })
  })

  it("переносит данные и снимает глобальную уникальность hash", () => {
    const db = createDatabase(dbPath)

    // данные пережили миграцию
    const history = db.getArtifactHistory("art-1")
    expect(history).toHaveLength(2)
    expect(history[0].version).toBe(2)
    expect(history[0].previous_hash).toBe(H(1))
    expect(history[1].blockchain_tx).toBe("0xTX")
    expect(history[1].notarized).toBe(1)

    // теперь тот же контент можно завести в другом артефакте
    expect(() => db.createArtifact("C:/docs/copy.pdf", H(1))).not.toThrow()

    // а внутри артефакта дубликат по-прежнему запрещён
    expect(() =>
      db.createArtifactVersion("art-1", "C:/docs/a.pdf", H(1))
    ).toThrowError(HashConflictError)

    db.close()
  })

  it("миграция идемпотентна: повторное открытие не ломает БД", () => {
    createDatabase(dbPath).close()
    const db = createDatabase(dbPath)
    expect(db.getArtifacts()).toHaveLength(2)
    db.close()
  })
})
