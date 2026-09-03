import { createHash } from "node:crypto"

/**
 * Связанный реестр якорей: непрерывность истории фиксаций.
 *
 * Отдельные пакеты доказывают принадлежность документа эпохе, но не полноту
 * истории: оператор мог зафиксировать данные, а на проверке предъявить лишь
 * часть, умолчав о неудобной эпохе. Связывание закрывает это — каждое звено
 * коммитится к предыдущему, и опубликованная «голова» фиксирует всю историю
 * целиком: изъять эпоху из середины нельзя, разрыв виден.
 *
 * Правила канона (отклонение ломает воспроизводимость проверки):
 * - доменный префикс 0x02 — отдельный от merkle-канона, где лист 0x00,
 *   а внутренний узел 0x01; звено цепи нельзя выдать за узел дерева;
 * - Cₙ = SHA-256(0x02 ‖ Cₙ₋₁ ‖ rootₙ) — порядок частей фиксирован,
 *   в отличие от merkle-узлов пары НЕ сортируются: здесь порядок значим,
 *   он и есть направление времени;
 * - C₀ = SHA-256(0x02 ‖ "yggdrasil/chain/v1") — генезис постоянен;
 *   различие реестров даёт не он, а адрес, с которого идёт якорение,
 *   и первый же пакет.
 *
 * On-chain уходит Cₙ вместо голого корня пакета — контракт этого не замечает,
 * для него это те же 32 байта.
 */

const CHAIN_PREFIX = Buffer.from([0x02])
const GENESIS_LABEL = "yggdrasil/chain/v1"

function sha256(...parts: Buffer[]): Buffer {
  const h = createHash("sha256")
  for (const p of parts) h.update(p)
  return h.digest()
}

function hexToBuf(hex: string): Buffer {
  const clean = hex.startsWith("0x") ? hex.slice(2) : hex
  if (!/^[0-9a-fA-F]{64}$/.test(clean)) {
    throw new Error(`Некорректный hex-хеш (ожидается 32 байта): ${hex}`)
  }
  return Buffer.from(clean, "hex")
}

const bufToHex = (b: Buffer) => "0x" + b.toString("hex")

/** C₀ — корень цепочки, с которого начинается любой реестр. */
export function genesisRoot(): string {
  return bufToHex(sha256(CHAIN_PREFIX, Buffer.from(GENESIS_LABEL, "utf8")))
}

/** Cₙ = SHA-256(0x02 ‖ Cₙ₋₁ ‖ rootₙ) */
export function chainRoot(prevChainRoot: string, batchRoot: string): string {
  return bufToHex(sha256(CHAIN_PREFIX, hexToBuf(prevChainRoot), hexToBuf(batchRoot)))
}

export type ChainLink = {
  /** Cₙ₋₁ — голова цепи до этого звена */
  prev: string
  /** Корень merkle-пакета этой эпохи */
  batchRoot: string
  /** Cₙ — голова после звена; именно она уходит on-chain */
  chainRoot: string
}

export type ChainVerdict =
  | { ok: true; head: string; length: number }
  | { ok: false; reason: string; brokenAt: number }

/**
 * Проверяет непрерывность цепочки от генезиса к голове.
 * Звенья передаются в хронологическом порядке, от старых к новым.
 *
 * Используется и приложением (экран колец), и — через тот же канон —
 * независимым верификатором: аудитор должен получать тот же вердикт.
 */
export function verifyChain(links: ChainLink[]): ChainVerdict {
  let expectedPrev = genesisRoot()

  for (let i = 0; i < links.length; i++) {
    const link = links[i]

    if (link.prev !== expectedPrev) {
      return {
        ok: false,
        reason:
          i === 0
            ? "Первое звено не ссылается на генезис — начало истории отсутствует"
            : `Звено ${i + 1} ссылается не на предыдущую голову — эпоха изъята или переставлена`,
        brokenAt: i,
      }
    }

    const expected = chainRoot(link.prev, link.batchRoot)
    if (link.chainRoot !== expected) {
      return {
        ok: false,
        reason: `Звено ${i + 1}: голова не соответствует связке предыдущей головы и корня пакета`,
        brokenAt: i,
      }
    }

    expectedPrev = link.chainRoot
  }

  return { ok: true, head: expectedPrev, length: links.length }
}
