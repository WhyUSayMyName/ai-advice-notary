import { describe, it, expect } from "vitest"
import { anchorScope, parseRegistryId, registryId } from "../registry-core"

const A = "31337:0x" + "a".repeat(40)
const B = "11155111:0x" + "b".repeat(40)

describe("registry-core", () => {
  it("идентификатор нормализует регистр адреса", () => {
    const checksum = "0x5FbDB2315678afecb367f032d93F642f64180aa3"
    expect(registryId(31337, checksum)).toBe(registryId(31337n, checksum.toLowerCase()))
    expect(registryId(31337, checksum)).toBe("31337:0x5fbdb2315678afecb367f032d93f642f64180aa3")
  })

  it("одинаковый контракт в разных сетях — разные реестры", () => {
    const addr = "0x" + "c".repeat(40)
    expect(registryId(1, addr)).not.toBe(registryId(11155111, addr))
  })

  it("некорректный адрес — ошибка, а не странный идентификатор", () => {
    expect(() => registryId(1, "0xC")).toThrow()
  })

  it("разбор идентификатора обратен построению", () => {
    expect(parseRegistryId(B)).toEqual({ chainId: 11155111, contract: "0x" + "b".repeat(40) })
    expect(() => parseRegistryId("garbage")).toThrow()
  })

  it("якорь в текущем реестре решает, даже если рядом есть неизвестные", () => {
    expect(anchorScope([A], A)).toEqual({ kind: "current" })
    expect(anchorScope([B, A], A)).toEqual({ kind: "current" })
    expect(anchorScope([null, A], A)).toEqual({ kind: "current" })
  })

  it("только чужие реестры — проверять здесь нечего", () => {
    expect(anchorScope([B], A)).toEqual({ kind: "elsewhere", registries: [B] })
  })

  it("фиксация до учёта реестров или без следов якоря — неизвестность", () => {
    expect(anchorScope([null], A)).toEqual({ kind: "unknown" })
    expect(anchorScope([null, B], A)).toEqual({ kind: "unknown" })
    expect(anchorScope([], A)).toEqual({ kind: "unknown" })
  })
})
