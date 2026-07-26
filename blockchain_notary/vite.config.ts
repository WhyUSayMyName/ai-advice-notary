import { defineConfig } from "vite"
import path from "node:path"
import electron from "vite-plugin-electron/simple"
import react from "@vitejs/plugin-react"

export default defineConfig({
  // Явный IPv4: по умолчанию dev-сервер слушает только [::1], а Electron
  // резолвит localhost в 127.0.0.1 — окна получали ERR_CONNECTION_REFUSED
  server: { host: "127.0.0.1" },
  plugins: [
    react(),
    electron({
      main: {
        entry: "electron/main.ts",
        vite: {
          build: {
            rollupOptions: {
              external: ["better-sqlite3"],
            },
          },
        },
      },
      preload: {
        input: path.join(__dirname, "electron/preload.ts"),
        vite: {
          build: {
            rollupOptions: {
              external: ["better-sqlite3"],
            },
          },
        },
      },
      renderer:
        process.env.NODE_ENV === "test"
          ? undefined
          : {},
    }),
  ],
})