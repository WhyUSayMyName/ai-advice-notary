import { JsonRpcProvider } from "ethers"

/**
 * Проверка доступности узла. Отдельно от notary.ts: здесь проверяется
 * произвольный адрес, который пользователь только что ввёл, — он может
 * оказаться нерабочим, и это нормальный исход, а не ошибка приложения.
 */
let probe: JsonRpcProvider | null = null

function withTimeout<T>(p: Promise<T>, ms: number, label: string): Promise<T> {
  return new Promise((resolve, reject) => {
    const t = setTimeout(() => reject(new Error(`${label} (timeout ${ms}ms)`)), ms)
    p.then((v) => {
      clearTimeout(t)
      resolve(v)
    }).catch((e) => {
      clearTimeout(t)
      reject(e)
    })
  })
}

export async function connectRpc(rpcUrl?: string) {
  // Пустой адрес — узел из настроек. Интерфейсу полный адрес знать незачем:
  // у Alchemy и Infura в нём лежит ключ провайдера
  const url = rpcUrl?.trim() || process.env.RPC_URL
  if (!url) {
    throw new Error("Узел не задан: укажите адрес в поле «Сеть» или RPC_URL в .env")
  }

  // Предыдущую пробу закрываем: брошенный провайдер продолжает
  // переподключаться к узлу и засоряет лог до конца сессии
  probe?.destroy()
  probe = new JsonRpcProvider(url)

  try {
    // Если узел не отвечает, без таймаута ожидание висело бы вечно
    const network = await withTimeout(probe.getNetwork(), 4000, "RPC: getNetwork")
    const blockNumber = await withTimeout(probe.getBlockNumber(), 4000, "RPC: getBlockNumber")

    return { chainId: Number(network.chainId), blockNumber }
  } catch (e) {
    probe.destroy()
    probe = null
    throw e
  }
}

export function disposeProbe() {
  probe?.destroy()
  probe = null
}
