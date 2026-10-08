import "../src/main/index"
import { app, BrowserWindow, ipcMain, dialog } from "electron"
import { fileURLToPath } from "node:url"
import path from "node:path"

import { connectRpc, disposeProbe } from "../src/main/blockchain"
import { sha256FileHex } from "../src/main/filehash"
import {
  notaryIsNotarized,
  notaryGetRecord,
  notaryChainId,
  notaryRegistry,
  disposeChain,
  setPrivateKeyProvider,
} from "../src/main/notary"
import { getKeyStore } from "../src/main/key-store"
import { generateCertificatePdf } from "../src/main/certificate"
import { exportEvidenceBundle } from "../src/main/evidence"
import {
  anchorBatchForHash,
  onAnchorEvent,
  startAnchorService,
  stopAnchorService,
} from "../src/main/anchor"

import "dotenv/config"

const __dirname = path.dirname(fileURLToPath(import.meta.url))
process.env.APP_ROOT = path.join(__dirname, "..")

export const VITE_DEV_SERVER_URL = process.env["VITE_DEV_SERVER_URL"]
export const MAIN_DIST = path.join(process.env.APP_ROOT, "dist-electron")
export const RENDERER_DIST = path.join(process.env.APP_ROOT, "dist")

process.env.VITE_PUBLIC = VITE_DEV_SERVER_URL
  ? path.join(process.env.APP_ROOT, "public")
  : RENDERER_DIST

let win: BrowserWindow | null = null
let splash: BrowserWindow | null = null

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

ipcMain.handle("file:hashPath", async (_e, filePath: string) => {
  try {
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

// Ключ подписи. Наружу отдаётся только статус — сам ключ не покидает
// main-процесс ни в ответе, ни в логе.
ipcMain.handle("key:status", async () => {
  try {
    return { ok: true, status: getKeyStore().status() }
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) }
  }
})

ipcMain.handle("key:save", async (_e, privateKey: string) => {
  try {
    const address = getKeyStore().save(privateKey)
    // Контракт на запись мог быть создан со старым подписантом
    setPrivateKeyProvider(() => getKeyStore().read())
    return { ok: true, address, status: getKeyStore().status() }
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) }
  }
})

ipcMain.handle("key:clear", async () => {
  try {
    getKeyStore().clear()
    setPrivateKeyProvider(() => getKeyStore().read())
    return { ok: true, status: getKeyStore().status() }
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

      const chainId = await notaryChainId(payload.rpcUrl)

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
        // При пакетной фиксации в реестре лежит голова цепи, а не хеш документа.
        // Без этого блока сертификат отправил бы аудитора искать то, чего там нет.
        batch: anchorBatchForHash(payload.hashHex, await notaryRegistry(payload.rpcUrl)),
      })

      return { ok: true, filePath: save.filePath }
    } catch (e) {
      return { ok: false, error: e instanceof Error ? e.message : String(e) }
    }
  }
)

ipcMain.handle("evidence:export", async (_e, rpcUrl?: string) => {
  try {
    const bundle = await exportEvidenceBundle(rpcUrl)

    const save = await dialog.showSaveDialog({
      title: "Экспорт пакета доказательств",
      defaultPath: `evidence_${new Date().toISOString().slice(0, 10)}.json`,
      filters: [{ name: "JSON", extensions: ["json"] }],
    })

    if (save.canceled || !save.filePath) return { ok: false, canceled: true }

    const { writeFile } = await import("node:fs/promises")
    await writeFile(save.filePath, JSON.stringify(bundle, null, 2) + "\n", "utf8")

    return { ok: true, filePath: save.filePath, artifacts: bundle.artifacts.length }
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) }
  }
})

/**
 * Минимальное время показа заставки. Композиция собирается каскадом —
 * знак, резьба вордмарка по буквам, руны, кеннинг — и завершается около
 * 2,25 с; даём ей постоять целиком, иначе она гаснет сразу после сборки.
 */
const SPLASH_MIN_MS = 3000

function createSplash() {
  splash = new BrowserWindow({
    width: 660,
    height: 430,
    frame: false,
    transparent: true,
    resizable: false,
    movable: false,
    center: true,
    skipTaskbar: true,
    alwaysOnTop: true,
    show: false,
  })

  splash.once("ready-to-show", () => splash?.show())

  if (VITE_DEV_SERVER_URL) {
    splash.loadURL(`${VITE_DEV_SERVER_URL.replace(/\/$/, "")}/splash.html`)
  } else {
    splash.loadFile(path.join(RENDERER_DIST, "splash.html"))
  }
}

/** Вызов функции заставки; к этому моменту окно может быть уже закрыто */
function splashCall(fn: string, ...args: unknown[]) {
  if (!splash || splash.isDestroyed()) return
  const call = `window.${fn} && window.${fn}(${args.map((a) => JSON.stringify(a)).join(", ")})`
  splash.webContents.executeJavaScript(call).catch(() => {})
}

/**
 * Этапы запуска. Доля — не выдумка «для красоты»: каждый шаг соответствует
 * реальной работе, а свет на руне поднимается ровно по ним.
 */
const STAGES = {
  registry: { p: 0.25, text: "Открытие локального реестра" },
  recovery: { p: 0.6, text: "Сверка очереди фиксаций" },
  renderer: { p: 0.9, text: "Подготовка интерфейса" },
  ready: { p: 1, text: "Готово" },
} as const

function splashStage(stage: keyof typeof STAGES, textOverride?: string) {
  const { p, text } = STAGES[stage]
  splashCall("splashStatus", textOverride ?? text)
  splashCall("splashProgress", p)
}

async function closeSplash() {
  if (!splash || splash.isDestroyed()) return

  const w = splash
  splash = null

  try {
    await w.webContents.executeJavaScript(`window.splashFadeOut && window.splashFadeOut()`)
    setTimeout(() => {
      if (!w.isDestroyed()) w.destroy()
    }, 260)
  } catch {
    w.destroy()
  }
}

function createWindow() {
  win = new BrowserWindow({
    width: 1280,
    height: 820,
    minWidth: 940,
    minHeight: 600,
    // Показываем только после первой отрисовки — иначе видно белую вспышку
    show: false,
    backgroundColor: "#08090B",
    autoHideMenuBar: true,
    webPreferences: {
      preload: path.join(__dirname, "preload.mjs"),
    },
  })

  // Системное меню (File/Edit/View…) в этом приложении не используется
  win.setMenuBarVisibility(false)

  if (VITE_DEV_SERVER_URL) {
    win.loadURL(VITE_DEV_SERVER_URL)
  } else {
    win.loadFile(path.join(RENDERER_DIST, "index.html"))
  }
}

/** Заставка уступает место главному окну, выдержав минимальную паузу */
function revealMainWindow(splashShownAt: number) {
  const wait = Math.max(0, SPLASH_MIN_MS - (Date.now() - splashShownAt))
  setTimeout(() => {
    win?.show()
    void closeSplash()
  }, wait)
}

// События очереди фиксации транслируются во все окна renderer'а (кроме заставки)
onAnchorEvent((event) => {
  for (const w of BrowserWindow.getAllWindows()) {
    if (w === splash) continue
    w.webContents.send("anchor:updated", event)
  }
})

app.whenReady().then(() => {
  // Подписант берётся из защищённого хранилища ОС. Ставится до старта воркера:
  // иначе первая же отправка ушла бы с ключом из окружения.
  setPrivateKeyProvider(() => getKeyStore().read())

  createSplash()
  const splashShownAt = Date.now()

  createWindow()

  // Recovery: незавершённые фиксации сверяются с чейном, воркер стартует в фоне.
  // Недоступность узла на старте не должна ронять приложение — главное окно
  // откроется в любом случае, сбой лишь отражается на заставке.
  splashStage("registry")
  splashStage("recovery")
  startAnchorService()
    .then(({ confirmed, requeued }) => {
      splashStage(
        "renderer",
        confirmed || requeued
          ? `Восстановлено фиксаций: ${confirmed + requeued}`
          : undefined
      )
    })
    .catch((e) => {
      console.error("anchor service start failed:", e)
      // Узел недоступен — это не крах: очередь переживёт и дождётся.
      // Но молчать об этом нельзя, продукт о доверии обязан признавать сбой.
      splashCall("splashError", "Реестр недоступен — фиксации останутся в очереди")
    })

  win?.once("ready-to-show", () => {
    splashStage("ready")
    revealMainWindow(splashShownAt)
  })

  // Страховка: если renderer так и не отрисовался, приложение всё равно
  // не должно остаться навсегда под заставкой
  setTimeout(() => {
    if (win && !win.isVisible()) revealMainWindow(splashShownAt)
  }, 10_000)
})

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit()
})

// Аккуратное завершение: воркер останавливается, соединения с узлом
// закрываются. Иначе провайдеры продолжают переподключаться, пока
// процесс окончательно не умрёт.
app.on("before-quit", () => {
  stopAnchorService()
  disposeChain()
  disposeProbe()
})