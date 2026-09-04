import { describe, it, expect } from "vitest"
import fs from "node:fs"
import path from "node:path"
import { fileURLToPath } from "node:url"
import { APP_DATA_DIR, userDataDir } from "../app-paths"

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..", "..")

describe("каталог данных", () => {
  // Electron берёт имя каталога из package.json name. MCP-сервер вычисляет его
  // сам, без Electron. Если они разойдутся, приложение и MCP начнут писать
  // в разные базы — и ничего об этом не скажут: очередь просто перестанет
  // быть общей. Проверяется здесь, потому что заметить это иначе нечем.
  it("совпадает с полем name в package.json", () => {
    const pkg = JSON.parse(fs.readFileSync(path.join(root, "package.json"), "utf8"))
    expect(APP_DATA_DIR).toBe(pkg.name)
  })

  it("путь абсолютный и оканчивается именем каталога", () => {
    const dir = userDataDir()
    expect(path.isAbsolute(dir)).toBe(true)
    expect(path.basename(dir)).toBe(APP_DATA_DIR)
  })
})
