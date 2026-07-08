import path from "path"
import { app } from "electron"
import { createDatabase, type NotaryDatabase } from "./database-core"

export type { ArtifactRecord, CreateVersionResult } from "./database-core"
export { HashConflictError } from "./database-core"

let instance: NotaryDatabase | null = null

function getDb(): NotaryDatabase {
  if (!instance) {
    instance = createDatabase(path.join(app.getPath("userData"), "notary.db"))
  }
  return instance
}

export const getArtifacts: NotaryDatabase["getArtifacts"] = (...args) =>
  getDb().getArtifacts(...args)

export const getArtifactsGroupedLatest: NotaryDatabase["getArtifactsGroupedLatest"] = (...args) =>
  getDb().getArtifactsGroupedLatest(...args)

export const getArtifactHistory: NotaryDatabase["getArtifactHistory"] = (...args) =>
  getDb().getArtifactHistory(...args)

export const getLatestArtifactVersion: NotaryDatabase["getLatestArtifactVersion"] = (...args) =>
  getDb().getLatestArtifactVersion(...args)

export const getArtifactByHash: NotaryDatabase["getArtifactByHash"] = (...args) =>
  getDb().getArtifactByHash(...args)

export const getArtifactByPath: NotaryDatabase["getArtifactByPath"] = (...args) =>
  getDb().getArtifactByPath(...args)

export const createArtifact: NotaryDatabase["createArtifact"] = (...args) =>
  getDb().createArtifact(...args)

export const createArtifactVersion: NotaryDatabase["createArtifactVersion"] = (...args) =>
  getDb().createArtifactVersion(...args)

export const upsertArtifact: NotaryDatabase["upsertArtifact"] = (...args) =>
  getDb().upsertArtifact(...args)

export const markArtifactNotarized: NotaryDatabase["markArtifactNotarized"] = (...args) =>
  getDb().markArtifactNotarized(...args)
