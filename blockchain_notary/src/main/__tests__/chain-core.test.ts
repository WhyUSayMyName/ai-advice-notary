import { describe, it, expect } from "vitest"
import { createHash } from "node:crypto"
import { chainRoot, genesisRoot, verifyChain, type ChainLink } from "../chain-core"

const H = (n: number) => "0x" + String(n).padStart(64, "0")

/** Строит корректную цепочку из корней пакетов */
function buildChain(roots: string[]): ChainLink[] {
  let prev = genesisRoot()
  return roots.map((batchRoot) => {
    const link = { prev, batchRoot, chainRoot: chainRoot(prev, batchRoot) }
    prev = link.chainRoot
    return link
  })
}

describe("chain-core: канон связывания", () => {
  it("генезис детерминирован и не зависит от данных", () => {
    expect(genesisRoot()).toBe(genesisRoot())
    expect(genesisRoot()).toMatch(/^0x[0-9a-f]{64}$/)
  })

  it("звено считается по формуле SHA-256(0x02 ‖ prev ‖ root)", () => {
    const prev = H(1)
    const root = H(2)

    const expected =
      "0x" +
      createHash("sha256")
        .update(Buffer.from([0x02]))
        .update(Buffer.from(prev.slice(2), "hex"))
        .update(Buffer.from(root.slice(2), "hex"))
        .digest("hex")

    expect(chainRoot(prev, root)).toBe(expected)
  })

  it("порядок частей значим: связка не симметрична", () => {
    // В merkle-узлах пары сортируются, здесь — нет: порядок это время
    expect(chainRoot(H(1), H(2))).not.toBe(chainRoot(H(2), H(1)))
  })

  it("доменный префикс отделяет звено от узла дерева", () => {
    // Узел дерева считается с 0x01, звено — с 0x02; при одинаковых
    // операндах значения обязаны различаться
    const asNode =
      "0x" +
      createHash("sha256")
        .update(Buffer.from([0x01]))
        .update(Buffer.from(H(1).slice(2), "hex"))
        .update(Buffer.from(H(2).slice(2), "hex"))
        .digest("hex")

    expect(chainRoot(H(1), H(2))).not.toBe(asNode)
  })

  it("отвергает некорректный hex", () => {
    expect(() => chainRoot("0x123", H(1))).toThrow(/hex/i)
  })
})

describe("chain-core: проверка непрерывности", () => {
  it("корректная цепочка проходит, голова совпадает с последним звеном", () => {
    const links = buildChain([H(10), H(11), H(12)])
    const verdict = verifyChain(links)

    expect(verdict.ok).toBe(true)
    if (verdict.ok) {
      expect(verdict.length).toBe(3)
      expect(verdict.head).toBe(links[2].chainRoot)
    }
  })

  it("пустая цепочка корректна, голова равна генезису", () => {
    const verdict = verifyChain([])
    expect(verdict.ok).toBe(true)
    if (verdict.ok) expect(verdict.head).toBe(genesisRoot())
  })

  it("ИЗЪЯТИЕ эпохи из середины обнаруживается", () => {
    const links = buildChain([H(10), H(11), H(12)])
    // Оператор «забыл» вторую эпоху и предъявляет первую и третью
    const withHole = [links[0], links[2]]

    const verdict = verifyChain(withHole)
    expect(verdict.ok).toBe(false)
    if (!verdict.ok) {
      expect(verdict.brokenAt).toBe(1)
      expect(verdict.reason).toContain("изъята")
    }
  })

  it("ПЕРЕСТАНОВКА эпох обнаруживается", () => {
    const links = buildChain([H(10), H(11), H(12)])
    const swapped = [links[0], links[2], links[1]]

    expect(verifyChain(swapped).ok).toBe(false)
  })

  it("УСЕЧЕНИЕ начала обнаруживается: первое звено не от генезиса", () => {
    const links = buildChain([H(10), H(11), H(12)])
    // Предъявлены только поздние эпохи — начало истории скрыто
    const verdict = verifyChain(links.slice(1))

    expect(verdict.ok).toBe(false)
    if (!verdict.ok) {
      expect(verdict.brokenAt).toBe(0)
      expect(verdict.reason).toContain("генезис")
    }
  })

  it("ПОДМЕНА состава эпохи обнаруживается: голова не сходится с корнем", () => {
    const links = buildChain([H(10), H(11)])
    // Корень пакета подменён, а голова оставлена прежней
    const tampered = [{ ...links[0], batchRoot: H(99) }, links[1]]

    const verdict = verifyChain(tampered)
    expect(verdict.ok).toBe(false)
    if (!verdict.ok) expect(verdict.brokenAt).toBe(0)
  })

  it("дописывание в конец не ломает уже опубликованную голову", () => {
    // Ключевое свойство: голова фиксирует прошлое, но не запрещает рост
    const links = buildChain([H(10), H(11)])
    const grown = buildChain([H(10), H(11), H(12)])

    expect(grown.slice(0, 2)).toEqual(links)
    expect(verifyChain(grown).ok).toBe(true)
  })
})

describe("золотые значения канона", () => {
  // Те же литералы проверяет тест независимого верификатора
  // (verifier-cli/test/verify.test.mjs). Две реализации канона не делят код;
  // расхождение любой из них с этими значениями ломает тесты на своей стороне.

  it("merkle-корень, путь и голова цепи для листьев H(1), H(2), H(3)", async () => {
    const { buildMerkleTree } = await import("../merkle-core")
    const tree = buildMerkleTree([H(1), H(2), H(3)])

    expect(tree.root).toBe("0x93e34ecb30d456c2bb3903c45dd51d053db3e66522a0a2eaf5fafa58312ed037")
    expect(tree.proofFor(H(2))).toEqual([
      "0x1fd4247443c9440cb3c48c28851937196bc156032d70a96c98e127ecb347e45f",
      "0xd9cf8add8675a1b25627d7b0ec33bc177cb3930b0b6e995d79c386b980b2f4d6",
    ])
    expect(genesisRoot()).toBe("0xc06d7b0c82d4f9a6e767a461f10787d4d6db8703570e9f6613e602ddf259a758")
    expect(chainRoot(genesisRoot(), tree.root)).toBe(
      "0xbab3c3544624d957e6edf40d15dd6e3097aa2189a88663e579236977865f7b3e"
    )
  })
})
