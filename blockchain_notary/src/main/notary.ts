import "dotenv/config";
import { JsonRpcProvider, Wallet, Contract } from "ethers";

// Единый источник ABI: экспортируется из hardhat-артефакта скриптом scripts/deploy-notary.ts
import NOTARY_ABI from "./abi/Notary.json";

function mustEnv(name: string): string {
  const v = process.env[name];
  if (!v) throw new Error(`Missing env: ${name}`);
  return v;
}

function providerFor(rpcUrl?: string) {
  return new JsonRpcProvider(rpcUrl ?? mustEnv("RPC_URL"));
}

function contractFor(rpcUrl?: string) {
  const provider = providerFor(rpcUrl);
  const signer = new Wallet(mustEnv("NOTARY_PK"), provider);
  return new Contract(mustEnv("NOTARY_ADDRESS"), NOTARY_ABI, signer);
}

export async function notaryIsNotarized(hashHex: string, rpcUrl?: string) {
  const c = contractFor(rpcUrl);
  const notarized: boolean = await c.isNotarized(hashHex);
  return { notarized };
}

export async function notaryGetRecord(hashHex: string, rpcUrl?: string) {
  const c = contractFor(rpcUrl);
  const [author, timestamp, exists] = await c.getRecord(hashHex);
  return {
    author: String(author),
    timestamp: Number(timestamp),
    exists: Boolean(exists),
  };
}

/**
 * Отправка транзакции с раздельным ожиданием подтверждения —
 * используется anchor-сервисом, чтобы зафиксировать tx hash в очереди
 * до того, как транзакция попадёт в блок.
 */
export async function notarySendNotarize(hashHex: string, rpcUrl?: string) {
  const c = contractFor(rpcUrl)
  const tx = await c.notarize(hashHex)

  return {
    txHash: tx.hash as string,
    wait: async () => {
      const receipt = await tx.wait()
      return { blockNumber: (receipt?.blockNumber ?? null) as number | null }
    },
  }
}

export async function notaryNotarize(hashHex: string, rpcUrl?: string) {
  try {
    const c = contractFor(rpcUrl);
    const tx = await c.notarize(hashHex);
    const receipt = await tx.wait();

    return {
      txHash: tx.hash,
      blockNumber: receipt?.blockNumber ?? null,
    };
  } catch (error) {
    console.error("notaryNotarize failed:", error);
    throw error;
  }
}