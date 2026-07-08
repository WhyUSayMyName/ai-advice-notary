import { sha256FileHex } from "./filehash"
import {
  createArtifact,
  createArtifactVersion,
  getArtifactByHash,
  getArtifactsGroupedLatest,
  getArtifactHistory,
  getLatestArtifactVersion,
  markArtifactNotarized,
  upsertArtifact,
} from "./database"
import {
  notaryGetRecord,
  notaryIsNotarized,
  notaryNotarize,
} from "./notary"

export async function registerArtifact(filePath: string, displayName?: string) {
  const hash = await sha256FileHex(filePath)

  upsertArtifact(filePath, hash, displayName)

  const localRecord = getArtifactByHash(hash)

  return {
    hash,
    localRecord,
  }
}

export async function registerArtifactVersion(
  artifactId: string,
  filePath: string,
  displayName?: string
) {
  const hash = await sha256FileHex(filePath)

  // Конфликт со старой версией (HashConflictError) уходит наверх — IPC-слой
  // превратит его в { ok: false, error } с понятным текстом
  const result = createArtifactVersion(artifactId, filePath, hash, displayName)

  return {
    hash,
    unchanged: result.unchanged,
    localRecord: result.record,
  }
}

export async function createNewArtifact(filePath: string, displayName?: string) {
  const hash = await sha256FileHex(filePath)

  // Одинаковое содержимое может числиться в разных артефактах —
  // «создать новый» всегда создаёт новый документ
  createArtifact(filePath, hash, displayName)

  const localRecord = getArtifactByHash(hash)

  return {
    hash,
    localRecord,
  }
}

export async function notarizeArtifact(filePath: string, displayName?: string, rpcUrl?: string) {
  const hash = await sha256FileHex(filePath)

  upsertArtifact(filePath, hash, displayName)

  const chainState = await notaryIsNotarized(hash, rpcUrl)

  if (chainState.notarized) {
    const existing = getArtifactByHash(hash)

    return {
      hash,
      alreadyNotarized: true,
      txHash: existing?.blockchain_tx ?? null,
      artifact: existing ?? null,
    }
  }

  const result = await notaryNotarize(hash, rpcUrl)

  markArtifactNotarized(hash, result.txHash)

  const updated = getArtifactByHash(hash)

  return {
    hash,
    alreadyNotarized: false,
    txHash: result.txHash,
    blockNumber: result.blockNumber,
    artifact: updated ?? null,
  }
}

export async function notarizeArtifactVersion(
  artifactId: string,
  filePath: string,
  displayName?: string,
  rpcUrl?: string
) {
  const hash = await sha256FileHex(filePath)

  const versionResult = createArtifactVersion(artifactId, filePath, hash, displayName)

  const chainState = await notaryIsNotarized(hash, rpcUrl)

  if (chainState.notarized) {
    const record = getArtifactByHash(hash)

    return {
      hash,
      unchanged: versionResult.unchanged,
      alreadyNotarized: true,
      txHash: record?.blockchain_tx ?? null,
      artifact: record ?? null,
    }
  }

  const result = await notaryNotarize(hash, rpcUrl)

  markArtifactNotarized(hash, result.txHash)

  const updated = getArtifactByHash(hash)

  return {
    hash,
    unchanged: versionResult.unchanged,
    alreadyNotarized: false,
    txHash: result.txHash,
    blockNumber: result.blockNumber,
    artifact: updated ?? null,
  }
}

export async function verifyArtifact(filePath: string, rpcUrl?: string) {
  const hash = await sha256FileHex(filePath)
  const record = await notaryGetRecord(hash, rpcUrl)
  const localRecord = getArtifactByHash(hash)

  return {
    hash,
    existsOnChain: record.exists,
    author: record.author,
    timestamp: record.timestamp,
    localRecord,
  }
}

export function listArtifacts() {
  return getArtifactsGroupedLatest()
}

export function listArtifactHistory(artifactId: string) {
  return getArtifactHistory(artifactId)
}

export function getArtifactLatestVersion(artifactId: string) {
  return getLatestArtifactVersion(artifactId)
}