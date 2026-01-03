import { contextBridge, ipcRenderer } from "electron"

contextBridge.exposeInMainWorld("api", {
  // system
  ping: () => ipcRenderer.invoke("app:ping"),

  // rpc
  connectRpc: (url: string) => ipcRenderer.invoke("rpc:connect", url),

  // files
  pickAndHash: () => ipcRenderer.invoke("file:pickAndHash"),
  hashPath: (filePath: string) => ipcRenderer.invoke("file:hashPath", filePath),

  // notary
  notaryIsNotarized: (hashHex: string, rpcUrl?: string) =>
    ipcRenderer.invoke("notary:isNotarized", hashHex, rpcUrl),

  notaryGetRecord: (hashHex: string, rpcUrl?: string) =>
    ipcRenderer.invoke("notary:getRecord", hashHex, rpcUrl),

  notaryNotarize: (hashHex: string, rpcUrl?: string) =>
    ipcRenderer.invoke("notary:notarize", hashHex, rpcUrl),

  saveCertificatePdf: (payload: {
  filePath: string
  hashHex: string
  rpcUrl: string
  author: string
  timestamp: number
  txHash: string
}) => ipcRenderer.invoke("cert:savePdf", payload),

})
