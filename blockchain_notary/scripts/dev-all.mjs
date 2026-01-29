import { spawn } from "node:child_process"
import process from "node:process"

function run(command, args, name, options = {}) {
  console.log(`▶ ${name}`)
  const p = spawn(command, args, {
    stdio: "inherit",
    shell: true, // ✅ важно для Windows (cmd/npx/npm)
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
  // ⚠️ Hardhat проект у тебя, скорее всего, в корне репозитория (на уровень выше),
  // поэтому запускаем hardhat из .. (если у тебя hardhat реально внутри blockchain_notary — убери cwd)
  const hardhatCwd = process.cwd().endsWith("blockchain_notary")
    ? process.cwd().replace(/blockchain_notary$/, "")
    : process.cwd()

  // Нормализуем путь (убираем хвостовой слеш)
  const hhCwd = hardhatCwd.replace(/[\\/]+$/, "")

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
  // Тоже не await — dev-сервер должен жить
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
