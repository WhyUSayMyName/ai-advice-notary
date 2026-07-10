import { build } from "esbuild"

// MCP-сервер работает в обычном Node (его запускает MCP-клиент, не Electron),
// поэтому better-sqlite3 подменяется сборкой под Node-ABI (better-sqlite3-node) —
// тот же приём, что в vitest.config.ts.
await build({
  entryPoints: ["src/mcp/server.ts"],
  outfile: "dist-mcp/server.mjs",
  bundle: true,
  platform: "node",
  format: "esm",
  target: "node18",
  alias: { "better-sqlite3": "better-sqlite3-node" },
  external: ["better-sqlite3-node"],
  banner: {
    // 1) createRequire — стандартный мост для CJS-зависимостей в ESM-бандле.
    // 2) stdout принадлежит JSON-RPC: любые console.log сторонних библиотек
    //    (баннер dotenv, ретраи ethers) перенаправляются в stderr; SDK пишет
    //    фреймы через process.stdout.write и переопределения не замечает.
    // 3) EPIPE при закрытии пайпа клиентом — штатное завершение, не крэш.
    js: [
      "import { createRequire } from 'node:module'; const require = createRequire(import.meta.url);",
      "process.env.DOTENV_CONFIG_QUIET ||= 'true';",
      "console.log = (...a) => console.error(...a);",
      "process.stdout.on('error', (e) => { if (e && e.code === 'EPIPE') process.exit(0); });",
    ].join("\n"),
  },
  logLevel: "info",
})
