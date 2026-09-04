import "dotenv/config"
import { JsonRpcProvider, Wallet, Contract } from "ethers"

// Единый источник ABI: экспортируется из hardhat-артефакта скриптом scripts/deploy-notary.ts
import NOTARY_ABI from "./abi/Notary.json"

function mustEnv(name: string): string {
  const v = process.env[name]
  if (!v) throw new Error(`Missing env: ${name}`)
  return v
}

type Handles = {
  key: string
  provider: JsonRpcProvider
  /** Только чтение — приватный ключ не нужен и не запрашивается */
  read: Contract
  /** Отправка транзакций; создаётся лениво, чтобы читать можно было без ключа */
  write?: Contract
}

/**
 * Одно активное подключение на приложение.
 *
 * Раньше провайдер создавался на КАЖДЫЙ вызов. Провайдер держит соединение
 * и собственный цикл переподключения, а брошенный продолжает стучаться в узел
 * вечно: прогон аудита по 14 документам оставлял за собой 14 таких «призраков»,
 * и лог заполнялся их попытками. Здесь живёт ровно одно подключение, а при
 * смене адреса или контракта предыдущее закрывается явно.
 */
let active: Handles | null = null

function handlesFor(rpcUrl?: string): Handles {
  const url = rpcUrl ?? mustEnv("RPC_URL")
  const address = mustEnv("NOTARY_ADDRESS")
  const key = `${url}|${address}`

  if (active?.key === key) return active

  active?.provider.destroy()

  // cacheTimeout: -1 отключает кэш ответов узла. По умолчанию ethers держит
  // их около 250 мс, включая getTransactionCount — и две транзакции подряд
  // получают один и тот же nonce. На локальном узле с мгновенным майнингом
  // это воспроизводится всегда: вторая эпоха падает с «nonce too low».
  const provider = new JsonRpcProvider(url, undefined, { cacheTimeout: -1 })
  active = { key, provider, read: new Contract(address, NOTARY_ABI, provider) }
  return active
}

/**
 * Источник приватного ключа. По умолчанию — окружение, чтобы e2e и скрипты
 * работали как прежде; приложение подменяет его на защищённое хранилище ОС
 * (см. key-store.ts). Модуль сознательно не знает про Electron.
 */
let privateKeyProvider: () => string | null = () => process.env.NOTARY_PK ?? null

export function setPrivateKeyProvider(provider: () => string | null) {
  privateKeyProvider = provider
  // Подписант мог смениться — контракт на запись пересоздастся с новым ключом
  if (active) active.write = undefined
}

function writeContract(rpcUrl?: string): Contract {
  const h = handlesFor(rpcUrl)
  if (!h.write) {
    const pk = privateKeyProvider()
    if (!pk) {
      throw new Error(
        "Ключ подписи не задан. Укажите его в разделе «Ключ подписи» — он будет " +
          "сохранён в защищённом хранилище операционной системы."
      )
    }
    h.write = new Contract(mustEnv("NOTARY_ADDRESS"), NOTARY_ABI, new Wallet(pk, h.provider))
  }
  return h.write
}

/** Закрывает активное подключение — вызывается при завершении приложения. */
export function disposeChain() {
  active?.provider.destroy()
  active = null
}

/** chainId активного подключения — для пакета доказательств и сертификата. */
export async function notaryChainId(rpcUrl?: string): Promise<number> {
  const net = await handlesFor(rpcUrl).provider.getNetwork()
  return Number(net.chainId)
}

export async function notaryIsNotarized(hashHex: string, rpcUrl?: string) {
  const notarized: boolean = await handlesFor(rpcUrl).read.isNotarized(hashHex)
  return { notarized }
}

export async function notaryGetRecord(hashHex: string, rpcUrl?: string) {
  const [author, timestamp, exists] = await handlesFor(rpcUrl).read.getRecord(hashHex)
  return {
    author: String(author),
    timestamp: Number(timestamp),
    exists: Boolean(exists),
  }
}

/**
 * Отправка транзакции с раздельным ожиданием подтверждения —
 * используется anchor-сервисом, чтобы зафиксировать tx hash в очереди
 * до того, как транзакция попадёт в блок.
 */
export async function notarySendNotarize(hashHex: string, rpcUrl?: string) {
  const tx = await writeContract(rpcUrl).notarize(hashHex)

  return {
    txHash: tx.hash as string,
    wait: async () => {
      const receipt = await tx.wait()
      return { blockNumber: (receipt?.blockNumber ?? null) as number | null }
    },
  }
}

/** Пакетная фиксация: якорит корень дерева Меркла (см. merkle-core.ts). */
export async function notarySendAnchorRoot(
  rootHex: string,
  leafCount: number,
  rpcUrl?: string
) {
  const tx = await writeContract(rpcUrl).anchorRoot(rootHex, leafCount)

  return {
    txHash: tx.hash as string,
    wait: async () => {
      const receipt = await tx.wait()
      return { blockNumber: (receipt?.blockNumber ?? null) as number | null }
    },
  }
}
