import { app, BrowserWindow, ipcMain, dialog } from "electron"
import { fileURLToPath } from "node:url"
import path from "node:path"

import { connectRpc } from "../src/main/blockchain"
import { sha256FileHex } from "../src/main/filehash"
import {
  notaryIsNotarized,
  notaryGetRecord,
  notaryNotarize,
} from "../src/main/notary" // ⚠️ файл должен называться notary.ts
import { generateCertificatePdf } from "../src/main/certificate"

import "dotenv/config"
import { JsonRpcProvider } from "ethers"


const __dirname = path.dirname(fileURLToPath(import.meta.url))
process.env.APP_ROOT = path.join(__dirname, "..")

export const VITE_DEV_SERVER_URL = process.env["VITE_DEV_SERVER_URL"]
export const MAIN_DIST = path.join(process.env.APP_ROOT, "dist-electron")
export const RENDERER_DIST = path.join(process.env.APP_ROOT, "dist")

process.env.VITE_PUBLIC = VITE_DEV_SERVER_URL
  ? path.join(process.env.APP_ROOT, "public")
  : RENDERER_DIST

let win: BrowserWindow | null = null

// ---------------- IPC ----------------

ipcMain.handle("rpc:connect", async (_e, rpcUrl: string) => {
  try {
    const data = await connectRpc(rpcUrl)
    return { ok: true, ...data }
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) }
  }
})

ipcMain.handle("file:pickAndHash", async () => {
  try {
    const res = await dialog.showOpenDialog({
      properties: ["openFile"],
    })

    if (res.canceled || res.filePaths.length === 0) {
      return { ok: false, canceled: true }
    }

    const filePath = res.filePaths[0]
    const hashHex = await sha256FileHex(filePath)
    return { ok: true, filePath, hashHex }
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) }
  }
})

ipcMain.handle("notary:isNotarized", async (_e, hashHex: string, rpcUrl?: string) => {
  try {
    return { ok: true, ...(await notaryIsNotarized(hashHex, rpcUrl)) }
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) }
  }
})

ipcMain.handle("notary:getRecord", async (_e, hashHex: string, rpcUrl?: string) => {
  try {
    return { ok: true, ...(await notaryGetRecord(hashHex, rpcUrl)) }
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) }
  }
})

ipcMain.handle("notary:notarize", async (_e, hashHex: string, rpcUrl?: string) => {
  try {
    return { ok: true, ...(await notaryNotarize(hashHex, rpcUrl)) }
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) }
  }
})

ipcMain.handle(
  "cert:savePdf",
  async (
    _e,
    payload: {
      filePath: string
      hashHex: string
      rpcUrl: string
      author: string
      timestamp: number
      txHash: string
    }
  ) => {
    try {
      const notaryAddress = process.env.NOTARY_ADDRESS
      if (!notaryAddress) return { ok: false, error: "Missing env: NOTARY_ADDRESS" }

      const provider = new JsonRpcProvider(payload.rpcUrl)
      const net = await provider.getNetwork()
      const chainId = Number(net.chainId)

      const defaultName = `certificate_${path.basename(payload.filePath)}.pdf`

      const save = await dialog.showSaveDialog({
        title: "Сохранить сертификат (PDF)",
        defaultPath: defaultName,
        filters: [{ name: "PDF", extensions: ["pdf"] }],
      })

      if (save.canceled || !save.filePath) return { ok: false, canceled: true }

      await generateCertificatePdf(save.filePath, {
        filePath: payload.filePath,
        hashHex: payload.hashHex,
        chainId,
        rpcUrl: payload.rpcUrl,
        notaryAddress,
        author: payload.author,
        timestamp: payload.timestamp,
        txHash: payload.txHash,
      })

      return { ok: true, filePath: save.filePath }
    } catch (e) {
      return { ok: false, error: e instanceof Error ? e.message : String(e) }
    }
  }
)
// ------------------------------------

function createWindow() {
  win = new BrowserWindow({
    webPreferences: {
      preload: path.join(__dirname, "preload.mjs"),
    },
  })

  if (VITE_DEV_SERVER_URL) {
    win.loadURL(VITE_DEV_SERVER_URL)
  } else {
    win.loadFile(path.join(RENDERER_DIST, "index.html"))
  }
}

app.whenReady().then(createWindow)

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit()
})

app.whenReady().then(createWindow)
