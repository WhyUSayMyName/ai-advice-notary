import { createHash } from "node:crypto"

/**
 * Каноничное дерево Меркла для пакетной фиксации.
 *
 * Правила канона (любое отклонение ломает воспроизводимость проверки):
 * - листья — SHA-256-хеши файлов, приводятся к нижнему регистру,
 *   дедуплицируются и сортируются лексикографически;
 * - доменное разделение: leaf = SHA-256(0x00 ‖ fileHash),
 *   node = SHA-256(0x01 ‖ min(a,b) ‖ max(a,b)) — защита от second-preimage
 *   (внутренний узел нельзя выдать за лист);
 * - пары сортированные, поэтому proof не содержит флагов лево/право;
 * - нечётный узел поднимается на уровень выше без пары
 *   (дублирование — известная уязвимость, CVE-2012-2459).
 */

const LEAF_PREFIX = Buffer.from([0x00])
const NODE_PREFIX = Buffer.from([0x01])

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

function nodeHash(a: Buffer, b: Buffer): Buffer {
  return Buffer.compare(a, b) <= 0
    ? sha256(NODE_PREFIX, a, b)
    : sha256(NODE_PREFIX, b, a)
}

export type MerkleTree = {
  root: string
  leafCount: number
  /** Хеши-соседи от листа к корню для документа с данным файловым хешем. */
  proofFor(fileHashHex: string): string[]
}

export function buildMerkleTree(fileHashesHex: string[]): MerkleTree {
  const unique = [...new Set(fileHashesHex.map((h) => h.toLowerCase()))].sort()
  if (unique.length === 0) {
    throw new Error("Пустой набор листьев")
  }

  const levels: Buffer[][] = [unique.map((h) => sha256(LEAF_PREFIX, hexToBuf(h)))]

  while (levels[levels.length - 1].length > 1) {
    const prev = levels[levels.length - 1]
    const next: Buffer[] = []
    for (let i = 0; i + 1 < prev.length; i += 2) {
      next.push(nodeHash(prev[i], prev[i + 1]))
    }
    if (prev.length % 2 === 1) {
      next.push(prev[prev.length - 1])
    }
    levels.push(next)
  }

  return {
    root: bufToHex(levels[levels.length - 1][0]),
    leafCount: unique.length,

    proofFor(fileHashHex: string): string[] {
      let index = unique.indexOf(fileHashHex.toLowerCase())
      if (index === -1) {
        throw new Error(`Хеш не входит в пакет: ${fileHashHex}`)
      }

      const proof: string[] = []
      for (let level = 0; level < levels.length - 1; level++) {
        const nodes = levels[level]
        const siblingIndex = index ^ 1
        if (siblingIndex < nodes.length) {
          proof.push(bufToHex(nodes[siblingIndex]))
        }
        index = Math.floor(index / 2)
      }
      return proof
    },
  }
}

/** Сворачивает proof от файла к корню и сравнивает с заявленным root. */
export function verifyMerkleProof(
  fileHashHex: string,
  proof: string[],
  rootHex: string
): boolean {
  let acc = sha256(LEAF_PREFIX, hexToBuf(fileHashHex))
  for (const sibling of proof) {
    acc = nodeHash(acc, hexToBuf(sibling))
  }
  return bufToHex(acc) === rootHex.toLowerCase()
}
