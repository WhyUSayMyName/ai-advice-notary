import { getArtifacts, type ArtifactRecord } from "./database"

export type VersionChainStatus =
  | "OK"
  | "BROKEN_LINK"
  | "MISSING_PREVIOUS_HASH"
  | "ROOT_VERSION_INVALID"

export type VersionChainItem = {
  id: number
  artifact_id: string
  display_name: string
  version: number
  hash: string
  previous_hash: string | null
  status: VersionChainStatus
  details: string
}

export type VersionChainReport = {
  artifact_id: string
  display_name: string
  ok: boolean
  items: VersionChainItem[]
}

function buildChainReport(records: ArtifactRecord[]): VersionChainReport {
  const sorted = [...records].sort((a, b) => a.version - b.version)
  const byHash = new Map(sorted.map((r) => [r.hash, r]))

  const items: VersionChainItem[] = []
  let ok = true

  for (let i = 0; i < sorted.length; i++) {
    const current = sorted[i]

    let status: VersionChainStatus = "OK"
    let details = "Цепочка корректна"

    if (current.version === 1) {
      if (current.previous_hash !== null) {
        status = "ROOT_VERSION_INVALID"
        details = "Корневая версия не должна содержать previous_hash"
        ok = false
      }
    } else {
      if (!current.previous_hash) {
        status = "MISSING_PREVIOUS_HASH"
        details = "Для версии выше 1 отсутствует previous_hash"
        ok = false
      } else {
        const prev = byHash.get(current.previous_hash)

        if (!prev) {
          status = "BROKEN_LINK"
          details = "Ссылка на предыдущую версию указывает на отсутствующий hash"
          ok = false
        } else if (prev.version !== current.version - 1) {
          status = "BROKEN_LINK"
          details = `Ожидалась ссылка на v${current.version - 1}, но найдена ссылка на v${prev.version}`
          ok = false
        }
      }
    }

    items.push({
      id: current.id,
      artifact_id: current.artifact_id,
      display_name: current.display_name,
      version: current.version,
      hash: current.hash,
      previous_hash: current.previous_hash,
      status,
      details,
    })
  }

  return {
    artifact_id: sorted[0]?.artifact_id ?? "",
    display_name: sorted[0]?.display_name ?? "",
    ok,
    items,
  }
}

export function inspectVersionChains(): VersionChainReport[] {
  const artifacts = getArtifacts()
  const groups = new Map<string, ArtifactRecord[]>()

  for (const artifact of artifacts) {
    const arr = groups.get(artifact.artifact_id) ?? []
    arr.push(artifact)
    groups.set(artifact.artifact_id, arr)
  }

  const reports: VersionChainReport[] = []

  for (const [, records] of groups) {
    if (records.length === 0) continue
    reports.push(buildChainReport(records))
  }

  return reports.sort((a, b) => a.display_name.localeCompare(b.display_name))
}