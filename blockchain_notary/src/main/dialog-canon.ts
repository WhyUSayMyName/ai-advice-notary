import { createHash, randomBytes } from "node:crypto"
import { stableStringify } from "./canonical-json"

/**
 * Канонизация LLM-диалогов (формат notary-dialog/v1).
 *
 * Диалог приводится к детерминированному JSON и хешируется вместе со
 * случайной солью. Соль защищает от перебора («а не задавали ли они вот
 * этот вопрос?»): без неё хеш известного текста восстановим подбором.
 * Соль не секрет ключевого типа — она хранится в самом каноническом файле
 * off-chain и попадает к аудитору вместе с ним; on-chain уходит только хеш.
 */

export const DIALOG_FORMAT = "notary-dialog/v1"

export type DialogRole = "system" | "user" | "assistant" | "tool"

export type DialogMessage = {
  role: DialogRole
  content: string
}

export type DialogInput = {
  /** Провайдер: "anthropic", "openai", "local"… */
  provider: string
  /** Идентификатор модели: "claude-fable-5"… */
  model: string
  /** Сообщения в хронологическом порядке. Порядок значим. */
  messages: DialogMessage[]
  /** Параметры генерации (temperature и т.п.) — только примитивы. */
  params?: Record<string, string | number | boolean>
  /** Момент начала диалога, ISO 8601 (опционально). */
  started_at?: string
}

export type CanonicalArtifact = {
  /** Канонические байты — содержимое файла артефакта. */
  canonical: string
  /** 0x + SHA-256 канонических байт. */
  hash: string
  salt: string
}

const ROLES: ReadonlySet<string> = new Set(["system", "user", "assistant", "tool"])
const SALT_RE = /^0x[0-9a-f]{64}$/

export function newSalt(): string {
  return "0x" + randomBytes(32).toString("hex")
}

export function sha256Hex(text: string): string {
  return "0x" + createHash("sha256").update(text, "utf8").digest("hex")
}

function requireNonEmpty(value: unknown, name: string): string {
  if (typeof value !== "string" || !value.trim()) {
    throw new Error(`Поле ${name} должно быть непустой строкой`)
  }
  return value.trim()
}

export function canonicalizeDialog(input: DialogInput, salt: string): CanonicalArtifact {
  if (!SALT_RE.test(salt)) {
    throw new Error("Соль должна быть 0x + 64 hex-символа (newSalt())")
  }
  if (!Array.isArray(input.messages) || input.messages.length === 0) {
    throw new Error("Диалог должен содержать хотя бы одно сообщение")
  }

  const messages = input.messages.map((m, i) => {
    if (!ROLES.has(m?.role)) {
      throw new Error(`Недопустимая роль в messages[${i}]: ${String(m?.role)}`)
    }
    if (typeof m.content !== "string") {
      throw new Error(`messages[${i}].content должен быть строкой`)
    }
    // Контент не нормализуется и не триммится: фиксируем байт-в-байт то,
    // что сказала модель / написал человек
    return { role: m.role, content: m.content }
  })

  let params: Record<string, string | number | boolean> | undefined
  if (input.params !== undefined) {
    params = {}
    for (const [k, v] of Object.entries(input.params)) {
      const t = typeof v
      if (t !== "string" && t !== "number" && t !== "boolean") {
        throw new Error(`params.${k}: допустимы только string | number | boolean`)
      }
      params[k] = v
    }
  }

  if (input.started_at !== undefined && Number.isNaN(Date.parse(input.started_at))) {
    throw new Error("started_at должен быть валидной датой ISO 8601")
  }

  // Явный whitelist полей: неизвестные поля входа не влияют на канон
  const canonical = stableStringify({
    format: DIALOG_FORMAT,
    salt,
    provider: requireNonEmpty(input.provider, "provider"),
    model: requireNonEmpty(input.model, "model"),
    started_at: input.started_at,
    params,
    messages,
  })

  return { canonical, hash: sha256Hex(canonical), salt }
}
