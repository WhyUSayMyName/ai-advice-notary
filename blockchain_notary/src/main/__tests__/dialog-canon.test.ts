import { describe, it, expect } from "vitest"
import { stableStringify } from "../canonical-json"
import { canonicalizeDialog, newSalt, type DialogInput } from "../dialog-canon"
import { canonicalizeAttestation, type AttestationInput } from "../attestation-canon"

const SALT = "0x" + "ab".repeat(32)
const H = (n: number) => "0x" + String(n).padStart(64, "0")

describe("canonical-json", () => {
  it("сортирует ключи на всех уровнях и не зависит от порядка ввода", () => {
    const a = stableStringify({ b: 1, a: { z: true, y: [1, 2] } })
    const b = stableStringify({ a: { y: [1, 2], z: true }, b: 1 })
    expect(a).toBe(b)
    expect(a).toBe('{"a":{"y":[1,2],"z":true},"b":1}')
  })

  it("undefined-поля отбрасываются, но null сохраняется", () => {
    expect(stableStringify({ a: undefined, b: null })).toBe('{"b":null}')
  })

  it("недетерминируемые значения — ошибка, а не искажение", () => {
    expect(() => stableStringify({ a: NaN })).toThrow()
    expect(() => stableStringify({ a: () => 1 })).toThrow()
    expect(() => stableStringify({ a: new Date() })).toThrow()
  })
})

describe("dialog-canon", () => {
  const dialog: DialogInput = {
    provider: "anthropic",
    model: "claude-fable-5",
    messages: [
      { role: "user", content: "Какой допуск для фланца DN50?" },
      { role: "assistant", content: "Согласно ГОСТ 33259, ряд 1: ±0,5 мм.\nПроверьте исполнение." },
    ],
    params: { temperature: 0.2, max_tokens: 1024 },
  }

  it("детерминизм: один диалог + одна соль → один хеш, независимо от порядка полей", () => {
    const reordered: DialogInput = JSON.parse(JSON.stringify({
      params: { max_tokens: 1024, temperature: 0.2 },
      model: dialog.model,
      messages: dialog.messages,
      provider: dialog.provider,
    }))

    const a = canonicalizeDialog(dialog, SALT)
    const b = canonicalizeDialog(reordered, SALT)
    expect(a.hash).toBe(b.hash)
    expect(a.canonical).toBe(b.canonical)
  })

  it("порядок сообщений значим", () => {
    const swapped: DialogInput = {
      ...dialog,
      messages: [dialog.messages[1], dialog.messages[0]],
    }
    expect(canonicalizeDialog(swapped, SALT).hash).not.toBe(canonicalizeDialog(dialog, SALT).hash)
  })

  it("соль меняет хеш; канонические байты содержат соль (воспроизводимо аудитором)", () => {
    const a = canonicalizeDialog(dialog, SALT)
    const b = canonicalizeDialog(dialog, newSalt())
    expect(a.hash).not.toBe(b.hash)
    expect(a.canonical).toContain(SALT)
  })

  it("контент не триммится и не нормализуется", () => {
    const spaced: DialogInput = {
      ...dialog,
      messages: [{ role: "user", content: " текст с пробелом " }],
    }
    const plain: DialogInput = {
      ...dialog,
      messages: [{ role: "user", content: "текст с пробелом" }],
    }
    expect(canonicalizeDialog(spaced, SALT).hash).not.toBe(canonicalizeDialog(plain, SALT).hash)
  })

  it("неизвестные поля входа не влияют на канон (whitelist)", () => {
    const extra = { ...dialog, ui_theme: "dark", client: "web" } as DialogInput
    expect(canonicalizeDialog(extra, SALT).hash).toBe(canonicalizeDialog(dialog, SALT).hash)
  })

  it("валидация: пустые сообщения, кривая роль, кривая соль", () => {
    expect(() => canonicalizeDialog({ ...dialog, messages: [] }, SALT)).toThrow()
    expect(() =>
      canonicalizeDialog(
        { ...dialog, messages: [{ role: "hacker" as never, content: "x" }] },
        SALT
      )
    ).toThrow()
    expect(() => canonicalizeDialog(dialog, "не-соль")).toThrow()
  })
})

describe("attestation-canon", () => {
  const base: AttestationInput = {
    attestor: "инженер И.И. Иванов",
    verdict: "approved_with_changes",
    dialog_hashes: [H(2), H(1)],
    document_hash: H(9),
    comment: "Пункт 3 переписан вручную",
    attested_at: "2026-07-10T12:00:00.000Z",
  }

  it("ссылки на диалоги — множество: порядок и дубликаты не влияют на хеш", () => {
    const a = canonicalizeAttestation(base, SALT)
    const b = canonicalizeAttestation({ ...base, dialog_hashes: [H(1), H(2), H(1)] }, SALT)
    expect(a.hash).toBe(b.hash)
  })

  it("вердикт и документ входят в канон", () => {
    const a = canonicalizeAttestation(base, SALT)
    expect(canonicalizeAttestation({ ...base, verdict: "rejected" }, SALT).hash).not.toBe(a.hash)
    expect(canonicalizeAttestation({ ...base, document_hash: H(8) }, SALT).hash).not.toBe(a.hash)
  })

  it("валидация: без диалогов нельзя, кривой хеш нельзя", () => {
    expect(() => canonicalizeAttestation({ ...base, dialog_hashes: [] }, SALT)).toThrow()
    expect(() =>
      canonicalizeAttestation({ ...base, dialog_hashes: ["0x123"] }, SALT)
    ).toThrow()
  })
})
