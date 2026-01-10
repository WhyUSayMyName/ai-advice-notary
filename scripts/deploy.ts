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
  console.log("Deploying AdviceNotary...")

  const Factory = await ethers.getContractFactory("AdviceNotary")
  const notary = await Factory.deploy()
  await notary.waitForDeployment()

  const address = await notary.getAddress()
  console.log("✅ AdviceNotary deployed to:", address)

  // Write to root .env
  const envPath = path.resolve(process.cwd(), ".env")
  const current = fs.existsSync(envPath) ? fs.readFileSync(envPath, "utf8") : ""
  const updated = upsertEnvVar(current, "ADVICE_NOTARY_ADDRESS", address)
  fs.writeFileSync(envPath, updated, "utf8")
  console.log("✅ Updated .env: ADVICE_NOTARY_ADDRESS")
}

main().catch((error) => {
  console.error(error)
  process.exitCode = 1
})
