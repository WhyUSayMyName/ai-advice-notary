import { stableStringify } from "./canonical-json"
import { newSalt, sha256Hex, type CanonicalArtifact } from "./dialog-canon"

/**
 * Канонизация акта аттестации (формат notary-attestation/v1) —
 * второй элемент «цепочки ответственности».
 *
 * Диалог фиксируется автоматически и отвечает на вопрос «что сказала модель».
 * Аттестация — осознанный акт человека: «я, такой-то, рассмотрел эти диалоги
 * и утвердил / доработал / отклонил это решение». Разрыв между ними и
 * позволяет постфактум отличить провалидированное решение от сырой идеи ИИ.
 */

export const ATTESTATION_FORMAT = "notary-attestation/v1"

export type AttestationVerdict = "approved" | "approved_with_changes" | "rejected"

export type AttestationInput = {
  /** Кто утверждает: имя/email/табельный идентификатор. */
  attestor: string
  verdict: AttestationVerdict
  /** Хеши канонических диалогов, на основании которых принято решение. */
  dialog_hashes: string[]
  /** Хеш итогового документа/решения (опционально: вердикт может быть и «отклонить»). */
  document_hash?: string
  comment?: string
  /** Момент аттестации, ISO 8601. */
  attested_at: string
}

const VERDICTS: ReadonlySet<string> = new Set(["approved", "approved_with_changes", "rejected"])
const HASH_RE = /^0x[0-9a-f]{64}$/

export function canonicalizeAttestation(input: AttestationInput, salt = newSalt()): CanonicalArtifact {
  if (typeof input.attestor !== "string" || !input.attestor.trim()) {
    throw new Error("attestor должен быть непустой строкой")
  }
  if (!VERDICTS.has(input.verdict)) {
    throw new Error(`Недопустимый verdict: ${String(input.verdict)}`)
  }
  if (!Array.isArray(input.dialog_hashes) || input.dialog_hashes.length === 0) {
    throw new Error("Аттестация должна ссылаться хотя бы на один диалог")
  }
  for (const h of input.dialog_hashes) {
    if (!HASH_RE.test(h)) throw new Error(`Некорректный хеш диалога: ${String(h)}`)
  }
  if (input.document_hash !== undefined && !HASH_RE.test(input.document_hash)) {
    throw new Error(`Некорректный document_hash: ${String(input.document_hash)}`)
  }
  if (Number.isNaN(Date.parse(input.attested_at))) {
    throw new Error("attested_at должен быть валидной датой ISO 8601")
  }

  // Ссылки на диалоги — множество, а не последовательность:
  // сортировка + дедупликация делают канон независимым от порядка ввода
  const dialogHashes = [...new Set(input.dialog_hashes)].sort()

  const canonical = stableStringify({
    format: ATTESTATION_FORMAT,
    salt,
    attestor: input.attestor.trim(),
    verdict: input.verdict,
    dialog_hashes: dialogHashes,
    document_hash: input.document_hash,
    comment: input.comment,
    attested_at: input.attested_at,
  })

  return { canonical, hash: sha256Hex(canonical), salt }
}
