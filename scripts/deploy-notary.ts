import { ethers, artifacts, network } from "hardhat"
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

const EXPLORER: Record<number, string> = {
  11155111: "https://sepolia.etherscan.io",
}

/**
 * Проверки до отправки транзакции. Деплой в публичную сеть стоит времени
 * и тестовых средств, а hardhat на пустой URL или нулевом балансе отвечает
 * стек-трейсом, по которому не понять, что именно не заполнено.
 */
async function preflight() {
  const net = network.name
  const config = network.config as { url?: string; accounts?: unknown }

  if (net !== "hardhat" && net !== "localhost" && !config.url) {
    throw new Error(
      `Для сети «${net}» не задан URL узла. Заполните SEPOLIA_RPC_URL в корневом .env ` +
        `(шаблон — .env.example). Публичные бесплатные эндпоинты Sepolia в основном ` +
        `нерабочие: нужен свой ключ Alchemy или Infura.`
    )
  }

  const signers = await ethers.getSigners()
  if (signers.length === 0) {
    throw new Error(
      `Для сети «${net}» не задан ключ деплоя. Заполните DEPLOYER_PK в корневом .env. ` +
        `Это одноразовый тестовый аккаунт, не тот ключ, которым якорит приложение.`
    )
  }

  const deployer = signers[0]
  const chainId = Number((await ethers.provider.getNetwork()).chainId)
  const balance = await ethers.provider.getBalance(deployer.address)

  console.log(`Сеть:      ${net} (chainId ${chainId})`)
  console.log(`Деплойщик: ${deployer.address}`)
  console.log(`Баланс:    ${ethers.formatEther(balance)} ETH`)

  if (balance === 0n) {
    throw new Error(
      `На аккаунте ${deployer.address} нет средств. Для Sepolia возьмите тестовый ` +
        `ETH в кране (Google Cloud Web3 Faucet, Alchemy Faucet, sepolia-faucet.pk910.de). ` +
        `Деплой стоит около 0.0003 ETH.`
    )
  }

  return { chainId }
}

async function main() {
  const { chainId } = await preflight()

  const Notary = await ethers.getContractFactory("Notary")
  const notary = await Notary.deploy()

  const tx = notary.deploymentTransaction()
  if (tx) console.log(`Транзакция: ${tx.hash}`)
  console.log("Ждём подтверждения…")

  await notary.waitForDeployment()

  const addr = await notary.getAddress()
  console.log("✅ Notary deployed to:", addr)

  const explorer = EXPLORER[chainId]
  if (explorer) {
    console.log(`   ${explorer}/address/${addr}`)
    console.log(`   Верификация: npm run verify:sepolia -- ${addr}`)
  }

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
  // Ожидаемые ошибки конфигурации печатаются одной строкой: стек здесь
  // только мешает — он ничего не добавляет к «заполните SEPOLIA_RPC_URL».
  console.error(`
❌ ${e instanceof Error ? e.message : e}`)
  if (process.env.DEBUG) console.error(e)
  process.exitCode = 1
})
