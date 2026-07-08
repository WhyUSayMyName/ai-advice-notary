import { defineConfig } from "vitest/config"

export default defineConfig({
  resolve: {
    alias: {
      // Основной better-sqlite3 собран под ABI Electron; тесты бегут в Node,
      // поэтому подменяем его копией, собранной под Node (npm-алиас better-sqlite3-node).
      "better-sqlite3": "better-sqlite3-node",
    },
  },
  test: {
    include: ["src/**/*.test.ts"],
  },
})
