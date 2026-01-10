import { ethers } from "hardhat"
import fs from "node:fs"
import path from "node:path"

function upsertEnvVar(envText: string, key: string, value: string) {
  const line = `${key}=${value}`
  const re = new RegExp(`^${key}=.*$`, "m")
  if (re.test(envText)) return envText.replace(re, line)
  const suffix = envText.length && !envText.endsWith("\n") ? "\n" : ""
  return envText + suffix + line + "\n"
}

async function main() {
  const Notary = await ethers.getContractFactory("Notary")
  const notary = await Notary.deploy()
  await notary.waitForDeployment()

  const addr = await notary.getAddress()
  console.log("✅ Notary deployed to:", addr)

  // Write to root .env
  const envPath = path.resolve(process.cwd(), ".env")
  const current = fs.existsSync(envPath) ? fs.readFileSync(envPath, "utf8") : ""
  const updated = upsertEnvVar(current, "NOTARY_ADDRESS", addr)
  fs.writeFileSync(envPath, updated, "utf8")
  console.log("✅ Updated .env: NOTARY_ADDRESS")
}

main().catch((e) => {
  console.error(e)
  process.exitCode = 1
})
