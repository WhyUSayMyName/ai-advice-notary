import { describe, it, expect } from "vitest"
import { buildEvidenceBundle } from "../evidence-core"
import type { ArtifactRecord } from "../database-core"

const H = (n: number) => "0x" + String(n).padStart(64, "0")

let nextId = 1
function rec(partial: Partial<ArtifactRecord>): ArtifactRecord {
  return {
    id: nextId++,
    artifact_id: "art-1",
    display_name: "Doc",
    file_path: "C:\\docs\\report.pdf",
    hash: H(1),
    version: 1,
    previous_hash: null,
    created_at: 1000,
    blockchain_tx: null,
    notarized: 0,
    ...partial,
  }
}

describe("evidence-core", () => {
  it("собирает бандл формата notary-evidence/v1 с данными чейна", () => {
    const bundle = buildEvidenceBundle([rec({ notarized: 1, blockchain_tx: "0xTX" })], {
      contract: "0xCONTRACT",
      chainId: 31337,
      rpcUrl: "http://127.0.0.1:8545",
    })

    expect(bundle.format).toBe("notary-evidence/v1")
    expect(bundle.chain).toEqual({
      chain_id: 31337,
      contract: "0xCONTRACT",
      rpc_url_hint: "http://127.0.0.1:8545",
    })
    expect(bundle.artifacts).toHaveLength(1)
    expect(bundle.artifacts[0]).toMatchObject({
      hash: H(1),
      notarized: true,
      blockchain_tx: "0xTX",
      file_name: "report.pdf",
    })
    expect(bundle.verification.steps.length).toBeGreaterThan(0)
  })

  it("сортирует версии по возрастанию внутри артефакта", () => {
    const bundle = buildEvidenceBundle(
      [
        rec({ version: 3, hash: H(3), previous_hash: H(2) }),
        rec({ version: 1, hash: H(1) }),
        rec({ version: 2, hash: H(2), previous_hash: H(1) }),
      ],
      { contract: "0xC", chainId: null }
    )

    expect(bundle.artifacts.map((a) => a.version)).toEqual([1, 2, 3])
  })

  it("chainId и rpcUrl опциональны", () => {
    const bundle = buildEvidenceBundle([], { contract: "0xC", chainId: null })

    expect(bundle.chain.chain_id).toBeNull()
    expect(bundle.chain.rpc_url_hint).toBeNull()
    expect(bundle.artifacts).toEqual([])
  })
})
