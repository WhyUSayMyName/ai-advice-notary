import os from "node:os"
import path from "node:path"

/**
 * Имя каталога данных. Приложение получает его через app.getPath("userData"),
 * MCP-сервер вычисляет сам — Electron он не импортирует. Значение обязано
 * совпадать с полем `name` в package.json: именно оттуда Electron берёт имя
 * каталога. Разойдутся — приложение и MCP молча начнут писать в РАЗНЫЕ базы,
 * и очередь перестанет быть общей, ничем этого не показав.
 */
export const APP_DATA_DIR = "blockchain_notary"

/** Корень пользовательских данных — тот же, что вернул бы Electron. */
export function userDataDir(): string {
  const home = os.homedir()
  const base =
    process.platform === "win32"
      ? (process.env.APPDATA ?? path.join(home, "AppData", "Roaming"))
      : process.platform === "darwin"
        ? path.join(home, "Library", "Application Support")
        : (process.env.XDG_CONFIG_HOME ?? path.join(home, ".config"))

  return path.join(base, APP_DATA_DIR)
}
