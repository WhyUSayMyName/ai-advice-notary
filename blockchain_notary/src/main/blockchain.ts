import { JsonRpcProvider } from "ethers"

let provider: JsonRpcProvider | null = null

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

export async function connectRpc(rpcUrl: string) {
  provider = new JsonRpcProvider(rpcUrl)

  // Важно: если узел не отвечает, раньше могло висеть "вечно"
  const network = await withTimeout(provider.getNetwork(), 4000, "RPC: getNetwork")
  const blockNumber = await withTimeout(provider.getBlockNumber(), 4000, "RPC: getBlockNumber")

  return {
    chainId: Number(network.chainId),
    blockNumber,
  }
}
