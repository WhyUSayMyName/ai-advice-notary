import { ipcMain } from "electron"
import {
  registerArtifact,
  createNewArtifact,
  registerArtifactVersion,
  notarizeArtifact,
  notarizeArtifactVersion,
  verifyArtifact,
  listArtifacts,
  listArtifactHistory,
} from "./artifacts"
import { auditArtifacts } from "./audit"
import { inspectVersionChains } from "./version-chain"

ipcMain.handle("artifact:register", async (_event, filePath: string, displayName?: string) => {
  try {
    const data = await registerArtifact(filePath, displayName)
    return { ok: true, ...data }
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e)
    return { ok: false, error: msg }
  }
})

ipcMain.handle("artifact:create", async (_event, filePath: string, displayName?: string) => {
  try {
    const data = await createNewArtifact(filePath, displayName)
    return { ok: true, ...data }
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e)
    return { ok: false, error: msg }
  }
})

ipcMain.handle(
  "artifact:createVersion",
  async (_event, artifactId: string, filePath: string, displayName?: string) => {
    try {
      const data = await registerArtifactVersion(artifactId, filePath, displayName)
      return { ok: true, ...data }
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e)
      return { ok: false, error: msg }
    }
  }
)

ipcMain.handle(
  "artifact:notarize",
  async (_event, filePath: string, displayName?: string, rpcUrl?: string) => {
    try {
      const data = await notarizeArtifact(filePath, displayName, rpcUrl)
      return { ok: true, ...data }
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e)
      return { ok: false, error: msg }
    }
  }
)

ipcMain.handle(
  "artifact:notarizeVersion",
  async (_event, artifactId: string, filePath: string, displayName?: string, rpcUrl?: string) => {
    try {
      const data = await notarizeArtifactVersion(artifactId, filePath, displayName, rpcUrl)
      return { ok: true, ...data }
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e)
      return { ok: false, error: msg }
    }
  }
)

ipcMain.handle("artifact:verify", async (_event, filePath: string, rpcUrl?: string) => {
  try {
    const data = await verifyArtifact(filePath, rpcUrl)
    return { ok: true, ...data }
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e)
    return { ok: false, error: msg }
  }
})

ipcMain.handle("artifact:list", async () => {
  try {
    const data = listArtifacts()
    return { ok: true, artifacts: data }
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e)
    return { ok: false, error: msg }
  }
})

ipcMain.handle("artifact:history", async (_event, artifactId: string) => {
  try {
    const data = listArtifactHistory(artifactId)
    return { ok: true, history: data }
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e)
    return { ok: false, error: msg }
  }
})

ipcMain.handle("artifact:audit", async () => {
  try {
    const data = await auditArtifacts()
    return { ok: true, results: data }
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e)
    return { ok: false, error: msg }
  }
})

ipcMain.handle("artifact:inspectChains", async () => {
  try {
    const data = inspectVersionChains()
    return { ok: true, reports: data }
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e)
    return { ok: false, error: msg }
  }
})