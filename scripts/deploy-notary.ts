import { ethers, artifacts } from "hardhat"
import fs from "node:fs"
import path from "node:path"

function upsertEnvVar(envText: string, key: string, value: string) {
  const line = `${key}=${value}`
  const re = new RegExp(`^${key}=.*$`, "m")
  if (re.test(envText)) return envText.replace(re, line)
  const suffix = envText.length && !envText.endsWith("\n") ? "\n" : ""
  return envText + suffix + line + "\n"
}

function writeEnvVar(envPath: string, key: string, value: string) {
  const current = fs.existsSync(envPath) ? fs.readFileSync(envPath, "utf8") : ""
  fs.writeFileSync(envPath, upsertEnvVar(current, key, value), "utf8")
  console.log(`✅ Updated ${path.relative(process.cwd(), envPath)}: ${key}`)
}

async function main() {
  const Notary = await ethers.getContractFactory("Notary")
  const notary = await Notary.deploy()
  await notary.waitForDeployment()

  const addr = await notary.getAddress()
  console.log("✅ Notary deployed to:", addr)

  // Адрес контракта — в оба .env: корневой (hardhat) и приложения (Electron)
  writeEnvVar(path.resolve(process.cwd(), ".env"), "NOTARY_ADDRESS", addr)
  writeEnvVar(
    path.resolve(process.cwd(), "blockchain_notary", ".env"),
    "NOTARY_ADDRESS",
    addr
  )

  // ABI — единый источник для приложения, чтобы клиент не разъезжался с контрактом
  const artifact = await artifacts.readArtifact("Notary")
  const abiPath = path.resolve(
    process.cwd(),
    "blockchain_notary",
    "src",
    "main",
    "abi",
    "Notary.json"
  )
  fs.mkdirSync(path.dirname(abiPath), { recursive: true })
  fs.writeFileSync(abiPath, JSON.stringify(artifact.abi, null, 2) + "\n", "utf8")
  console.log(`✅ ABI exported to ${path.relative(process.cwd(), abiPath)}`)
}

main().catch((e) => {
  console.error(e)
  process.exitCode = 1
})
