import { ipcMain } from "electron"
import { connectRpc } from "./blockchain"

ipcMain.handle("rpc:connect", async (_event, rpcUrl: string) => {
  try {
    const data = await connectRpc(rpcUrl)
    return { ok: true, ...data }
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e)
    return { ok: false, error: msg }
  }
})
