import { spawn } from "node:child_process"
import fs from "node:fs"
import path from "node:path"
import process from "node:process"

const LOCAL_HOSTS = new Set(["127.0.0.1", "localhost", "[::1]", "::1"])

/**
 * dev:all поднимает локальный узел и делает локальный деплой, а скрипт деплоя
 * пишет NOTARY_ADDRESS в оба .env. Если приложение настроено на внешнюю сеть,
 * такой запуск молча подменил бы адрес настоящего контракта локальным — и
 * приложение искало бы реестр там, где его нет. Поэтому отказываемся до того,
 * как что-либо запущено.
 */
function refuseIfExternalNetwork(appDir) {
  const envPath = path.join(appDir, ".env")
  if (!fs.existsSync(envPath)) return

  const m = fs.readFileSync(envPath, "utf8").match(/^RPC_URL=(.+)$/m)
  if (!m) return

  let host
  try {
    host = new URL(m[1].trim()).hostname
  } catch {
    return
  }
  if (LOCAL_HOSTS.has(host)) return

  console.error(`
✋ dev:all остановлен: приложение настроено на внешнюю сеть (${host}).

   dev:all поднимает локальный узел и делает локальный деплой, а он
   перезаписал бы адрес контракта в .env — приложение потеряло бы
   настоящий реестр.

   Запуск с внешней сетью:        npm run dev
   Вернуться на локальный узел:   раскомментируйте локальные строки
                                  в blockchain_notary/.env
`)
  process.exit(1)
}

function run(command, args, name, options = {}) {
  console.log(`▶ ${name}`)
  const p = spawn(command, args, {
    stdio: "inherit",
    shell: true,
    ...options,
  })
  return new Promise((resolve, reject) => {
    p.on("exit", (code) => {
      if (code === 0) return resolve(p)
      reject(new Error(`${name} failed with code ${code}`))
    })
    p.on("error", reject)
  })
}

async function main() {
  // 1) Hardhat node

  const hardhatCwd = process.cwd().endsWith("blockchain_notary")
    ? process.cwd().replace(/blockchain_notary$/, "")
    : process.cwd()

  // Нормализуем путь (убираем хвостовой слеш)
  const hhCwd = hardhatCwd.replace(/[\\/]+$/, "")

  refuseIfExternalNetwork(path.join(hhCwd, "blockchain_notary"))

  console.log("1) Starting Hardhat node…")
  // Не await — нода должна жить в фоне
  const hhNode = spawn("npx", ["hardhat", "node"], {
    stdio: "inherit",
    shell: true,
    cwd: hhCwd,
  })

  // 2) Wait for RPC
  console.log("2) Waiting for http://127.0.0.1:8545 …")
  await run("npx", ["wait-on", "http-get://127.0.0.1:8545"], "wait-on", { cwd: process.cwd() })

  // 3) Deploy Notary
  console.log("3) Deploying Notary…")
  await run(
    "npx",
    ["hardhat", "run", "scripts/deploy-notary.ts", "--network", "localhost"],
    "deploy-notary",
    { cwd: hhCwd }
  )

  // 4) Start Vite/Electron
  console.log("4) Starting Vite/Electron…")
  spawn("npm", ["run", "dev"], {
    stdio: "inherit",
    shell: true,
    cwd: process.cwd(),
  })

  process.on("SIGINT", () => {
    console.log("\n🛑 Shutting down…")
    hhNode.kill("SIGINT")
    process.exit(0)
  })
}

main().catch((e) => {
  console.error("dev:all failed:", e)
  process.exit(1)
})
