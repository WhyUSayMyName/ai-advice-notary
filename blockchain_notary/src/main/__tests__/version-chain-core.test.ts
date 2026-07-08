import { describe, it, expect } from "vitest"
import { buildChainReport, buildChainReports } from "../version-chain-core"
import type { ArtifactRecord } from "../database-core"

const H = (n: number) => "0x" + String(n).padStart(64, "0")

let nextId = 1
function rec(partial: Partial<ArtifactRecord>): ArtifactRecord {
  return {
    id: nextId++,
    artifact_id: "art-1",
    display_name: "Doc",
    file_path: "C:/docs/a.pdf",
    hash: H(1),
    version: 1,
    previous_hash: null,
    created_at: Date.now(),
    blockchain_tx: null,
    notarized: 0,
    ...partial,
  }
}

describe("version-chain-core", () => {
  it("корректная цепочка v1→v2→v3 — все статусы OK", () => {
    const report = buildChainReport([
      rec({ version: 1, hash: H(1), previous_hash: null }),
      rec({ version: 2, hash: H(2), previous_hash: H(1) }),
      rec({ version: 3, hash: H(3), previous_hash: H(2) }),
    ])

    expect(report.ok).toBe(true)
    expect(report.items.map((i) => i.status)).toEqual(["OK", "OK", "OK"])
  })

  it("корневая версия с previous_hash — ROOT_VERSION_INVALID", () => {
    const report = buildChainReport([
      rec({ version: 1, hash: H(1), previous_hash: H(9) }),
    ])

    expect(report.ok).toBe(false)
    expect(report.items[0].status).toBe("ROOT_VERSION_INVALID")
  })

  it("версия выше 1 без previous_hash — MISSING_PREVIOUS_HASH", () => {
    const report = buildChainReport([
      rec({ version: 1, hash: H(1), previous_hash: null }),
      rec({ version: 2, hash: H(2), previous_hash: null }),
    ])

    expect(report.ok).toBe(false)
    expect(report.items[1].status).toBe("MISSING_PREVIOUS_HASH")
  })

  it("ссылка на несуществующий hash — BROKEN_LINK", () => {
    const report = buildChainReport([
      rec({ version: 1, hash: H(1), previous_hash: null }),
      rec({ version: 2, hash: H(2), previous_hash: H(99) }),
    ])

    expect(report.ok).toBe(false)
    expect(report.items[1].status).toBe("BROKEN_LINK")
  })

  it("ссылка через версию (v3 → v1) — BROKEN_LINK с деталями", () => {
    const report = buildChainReport([
      rec({ version: 1, hash: H(1), previous_hash: null }),
      rec({ version: 2, hash: H(2), previous_hash: H(1) }),
      rec({ version: 3, hash: H(3), previous_hash: H(1) }),
    ])

    expect(report.ok).toBe(false)
    expect(report.items[2].status).toBe("BROKEN_LINK")
    expect(report.items[2].details).toContain("v2")
  })

  it("buildChainReports группирует по артефактам и сортирует по имени", () => {
    const reports = buildChainReports([
      rec({ artifact_id: "b", display_name: "Бета", version: 1, hash: H(1) }),
      rec({ artifact_id: "a", display_name: "Альфа", version: 1, hash: H(2) }),
      rec({ artifact_id: "a", display_name: "Альфа", version: 2, hash: H(3), previous_hash: H(2) }),
    ])

    expect(reports).toHaveLength(2)
    expect(reports[0].display_name).toBe("Альфа")
    expect(reports[0].items).toHaveLength(2)
    expect(reports[0].ok).toBe(true)
    expect(reports[1].display_name).toBe("Бета")
  })
})
