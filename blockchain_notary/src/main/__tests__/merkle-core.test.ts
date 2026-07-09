import { describe, it, expect } from "vitest"
import { createHash } from "node:crypto"
import { buildMerkleTree, verifyMerkleProof } from "../merkle-core"

const H = (n: number) => "0x" + String(n).padStart(64, "0")
const hashes = (n: number) =>
  Array.from({ length: n }, (_, i) =>
    "0x" + createHash("sha256").update(`doc-${i}`).digest("hex")
  )

describe("merkle-core", () => {
  it("детерминизм: порядок и регистр входа не влияют на root", () => {
    const a = buildMerkleTree([H(1), H(2), H(3)])
    const b = buildMerkleTree([H(3).toUpperCase().replace("0X", "0x"), H(1), H(2)])
    expect(a.root).toBe(b.root)
  })

  it("дедупликация: повторный хеш не меняет дерево", () => {
    const a = buildMerkleTree([H(1), H(2)])
    const b = buildMerkleTree([H(1), H(2), H(2), H(1)])
    expect(a.root).toBe(b.root)
    expect(b.leafCount).toBe(2)
  })

  it.each([1, 2, 3, 5, 8, 100])("proof валиден для каждого листа (n=%i)", (n) => {
    const leaves = hashes(n)
    const tree = buildMerkleTree(leaves)

    for (const leaf of leaves) {
      const proof = tree.proofFor(leaf)
      expect(verifyMerkleProof(leaf, proof, tree.root)).toBe(true)
      expect(proof.length).toBeLessThanOrEqual(Math.ceil(Math.log2(Math.max(n, 2))) + 1)
    }
  })

  it("одиночный лист: пустой proof, root воспроизводим", () => {
    const tree = buildMerkleTree([H(7)])
    expect(tree.proofFor(H(7))).toEqual([])
    expect(verifyMerkleProof(H(7), [], tree.root)).toBe(true)
    // root ≠ сырому хешу файла — доменный префикс листа обязателен
    expect(tree.root).not.toBe(H(7))
  })

  it("чужой хеш с валидным proof другого листа не проходит", () => {
    const leaves = hashes(8)
    const tree = buildMerkleTree(leaves)
    const proof = tree.proofFor(leaves[3])

    expect(verifyMerkleProof(leaves[4], proof, tree.root)).toBe(false)
    expect(verifyMerkleProof(H(999), proof, tree.root)).toBe(false)
  })

  it("испорченный proof не проходит", () => {
    const leaves = hashes(8)
    const tree = buildMerkleTree(leaves)
    const proof = tree.proofFor(leaves[0])
    const corrupted = [...proof]
    corrupted[0] = H(666)

    expect(verifyMerkleProof(leaves[0], corrupted, tree.root)).toBe(false)
  })

  it("защита от second-preimage: внутренний узел не выдать за лист", () => {
    const leaves = hashes(4)
    const tree = buildMerkleTree(leaves)

    // Соседний узел верхнего уровня из proof листа 0 — это внутренний узел.
    // Попытка предъявить его как «файловый хеш» с укороченным proof
    // не должна сходиться к root (доменные префиксы 0x00/0x01 различают уровни).
    const proof = tree.proofFor(leaves[0])
    const internalNode = proof[proof.length - 1]
    const shortProof = proof.slice(0, -1)

    expect(verifyMerkleProof(internalNode, shortProof, tree.root)).toBe(false)
  })

  it("proofFor чужого хеша и пустой набор — ошибки", () => {
    const tree = buildMerkleTree([H(1)])
    expect(() => tree.proofFor(H(2))).toThrowError(/не входит/)
    expect(() => buildMerkleTree([])).toThrowError(/Пустой/)
  })
})
