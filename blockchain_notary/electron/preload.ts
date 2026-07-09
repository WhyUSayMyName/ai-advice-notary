import { contextBridge, ipcRenderer } from "electron"

contextBridge.exposeInMainWorld("api", {
  // system
  ping: () => ipcRenderer.invoke("app:ping"),

  // rpc
  connectRpc: (url: string) => ipcRenderer.invoke("rpc:connect", url),

  // files
  pickAndHash: () => ipcRenderer.invoke("file:pickAndHash"),
  hashPath: (filePath: string) => ipcRenderer.invoke("file:hashPath", filePath),

  // artifacts
  registerArtifact: (filePath: string, displayName?: string) =>
    ipcRenderer.invoke("artifact:register", filePath, displayName),

  createArtifact: (filePath: string, displayName?: string) =>
    ipcRenderer.invoke("artifact:create", filePath, displayName),

  createArtifactVersion: (artifactId: string, filePath: string, displayName?: string) =>
    ipcRenderer.invoke("artifact:createVersion", artifactId, filePath, displayName),

  notarizeArtifact: (filePath: string, displayName?: string, rpcUrl?: string) =>
    ipcRenderer.invoke("artifact:notarize", filePath, displayName, rpcUrl),

  notarizeArtifactVersion: (artifactId: string, filePath: string, displayName?: string, rpcUrl?: string) =>
    ipcRenderer.invoke("artifact:notarizeVersion", artifactId, filePath, displayName, rpcUrl),

  verifyArtifact: (filePath: string, rpcUrl?: string) =>
    ipcRenderer.invoke("artifact:verify", filePath, rpcUrl),

  listArtifacts: () =>
    ipcRenderer.invoke("artifact:list"),

  getArtifactHistory: (artifactId: string) =>
    ipcRenderer.invoke("artifact:history", artifactId),

  auditArtifacts: () =>
    ipcRenderer.invoke("artifact:audit"),

  inspectVersionChains: () =>
    ipcRenderer.invoke("artifact:inspectChains"),

  // notary
  notaryIsNotarized: (hashHex: string, rpcUrl?: string) =>
    ipcRenderer.invoke("notary:isNotarized", hashHex, rpcUrl),

  notaryGetRecord: (hashHex: string, rpcUrl?: string) =>
    ipcRenderer.invoke("notary:getRecord", hashHex, rpcUrl),

  notaryNotarize: (hashHex: string, rpcUrl?: string) =>
    ipcRenderer.invoke("notary:notarize", hashHex, rpcUrl),

  exportEvidence: (rpcUrl?: string) =>
    ipcRenderer.invoke("evidence:export", rpcUrl),

  // anchor queue
  listAnchorQueue: () => ipcRenderer.invoke("anchor:list"),

  onAnchorUpdated: (callback: (event: unknown) => void) => {
    const listener = (_e: Electron.IpcRendererEvent, payload: unknown) => callback(payload)
    ipcRenderer.on("anchor:updated", listener)
    return () => ipcRenderer.removeListener("anchor:updated", listener)
  },

  saveCertificatePdf: (payload: {
    filePath: string
    hashHex: string
    rpcUrl: string
    author: string
    timestamp: number
    txHash: string
  }) => ipcRenderer.invoke("cert:savePdf", payload),
})