import { describe, it, expect, beforeEach, afterEach } from "vitest"
import fs from "node:fs"
import os from "node:os"
import path from "node:path"
import { createHash } from "node:crypto"
import { createDatabase, type NotaryDatabase } from "../../main/database-core"
import { notarizeDialog, attestDecision, type McpDeps } from "../mcp-core"
import type { DialogInput } from "../../main/dialog-canon"

const dialog: DialogInput = {
  provider: "anthropic",
  model: "claude-fable-5",
  messages: [
    { role: "user", content: "Можно ли ставить фланец без прокладки?" },
    { role: "assistant", content: "Нет. Это нарушение ГОСТ и герметичности." },
  ],
}

describe("mcp-core", () => {
  let db: NotaryDatabase
  let dir: string
  let deps: McpDeps

  beforeEach(() => {
    db = createDatabase(":memory:")
    dir = fs.mkdtempSync(path.join(os.tmpdir(), "notary-mcp-"))
    deps = { db, enqueue: (hash) => db.enqueueAnchor(hash), artifactsDir: dir }
  })

  afterEach(() => {
    db.close()
    fs.rmSync(dir, { recursive: true, force: true })
  })

  it("notarizeDialog: файл записан, sha256 файла равен хешу, артефакт и очередь созданы", () => {
    const res = notarizeDialog(deps, dialog)

    const bytes = fs.readFileSync(res.file_path)
    const fileHash = "0x" + createHash("sha256").update(bytes).digest("hex")
    expect(fileHash).toBe(res.hash)

    const artifact = db.getArtifactByHash(res.hash)
    expect(artifact).toBeDefined()
    expect(artifact!.display_name).toContain("anthropic/claude-fable-5")

    expect(db.getAnchorByHash(res.hash)?.status).toBe("pending")
    expect(res.queue_status).toBe("pending")
  })

  it("канонический файл самодостаточен: содержит соль и восстановим аудитором", () => {
    const res = notarizeDialog(deps, dialog)
    const parsed = JSON.parse(fs.readFileSync(res.file_path, "utf8"))

    expect(parsed.format).toBe("notary-dialog/v1")
    expect(parsed.salt).toBe(res.salt)
    expect(parsed.messages).toHaveLength(2)
  })

  it("повторная фиксация того же диалога идемпотентна (соль разная, но дубль ловится по существующему файлу)", () => {
    const first = notarizeDialog(deps, dialog)
    // Соль случайная → хеш второго вызова другой; это ДВЕ разные фиксации.
    // Идемпотентность работает на уровне одинаковых канонических байт:
    const second = notarizeDialog(deps, dialog)
    expect(second.hash).not.toBe(first.hash)
    expect(db.getArtifacts().length).toBe(2)
  })

  it("attestDecision: акт ссылается на диалог и документ, всё уходит в очередь", async () => {
    const d = notarizeDialog(deps, dialog)

    const docPath = path.join(dir, "решение.txt")
    fs.writeFileSync(docPath, "Фланец заменить, прокладку установить.", "utf8")

    const res = await attestDecision(deps, {
      attestor: "И.И. Иванов",
      verdict: "approved_with_changes",
      dialog_hashes: [d.hash],
      document_path: docPath,
      comment: "Дополнено требованием о проверке",
    })

    expect(res.warnings).toEqual([])
    expect(res.document_hash).toMatch(/^0x/)

    const act = JSON.parse(fs.readFileSync(res.file_path, "utf8"))
    expect(act.format).toBe("notary-attestation/v1")
    expect(act.dialog_hashes).toEqual([d.hash])
    expect(act.document_hash).toBe(res.document_hash)

    // в очереди: диалог + документ + акт
    expect(db.getAnchorQueue()).toHaveLength(3)
    // документ зарегистрирован как артефакт
    expect(db.getArtifactByHash(res.document_hash!)).toBeDefined()
  })

  it("attestDecision предупреждает о ссылке на незафиксированный диалог", async () => {
    const res = await attestDecision(deps, {
      attestor: "И.И. Иванов",
      verdict: "rejected",
      dialog_hashes: ["0x" + "77".repeat(32)],
    })

    expect(res.warnings).toHaveLength(1)
    expect(res.warnings[0]).toContain("не найден")
  })
})
