"use strict";
const electron = require("electron");
electron.contextBridge.exposeInMainWorld("api", {
  // system
  ping: () => electron.ipcRenderer.invoke("app:ping"),
  // rpc
  connectRpc: (url) => electron.ipcRenderer.invoke("rpc:connect", url),
  // files
  pickAndHash: () => electron.ipcRenderer.invoke("file:pickAndHash"),
  hashPath: (filePath) => electron.ipcRenderer.invoke("file:hashPath", filePath),
  // notary
  notaryIsNotarized: (hashHex, rpcUrl) => electron.ipcRenderer.invoke("notary:isNotarized", hashHex, rpcUrl),
  notaryGetRecord: (hashHex, rpcUrl) => electron.ipcRenderer.invoke("notary:getRecord", hashHex, rpcUrl),
  notaryNotarize: (hashHex, rpcUrl) => electron.ipcRenderer.invoke("notary:notarize", hashHex, rpcUrl),
  saveCertificatePdf: (payload) => electron.ipcRenderer.invoke("cert:savePdf", payload)
});
