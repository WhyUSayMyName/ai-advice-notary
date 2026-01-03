import "dotenv/config"
import { JsonRpcProvider, Wallet, Contract } from "ethers"

const NOTARY_ABI = [
  "function notarize(bytes32 hash)",
  "function isNotarized(bytes32 hash) view returns (bool)",
  "function getRecord(bytes32 hash) view returns (address author, uint256 timestamp, bool exists)",
  "event Notarized(bytes32 indexed hash, address indexed author, uint256 timestamp)",
]

function mustEnv(name: string): string {
  const v = process.env[name]
  if (!v) throw new Error(`Missing env: ${name}`)
  return v
}

function providerFor(rpcUrl?: string) {
  return new JsonRpcProvider(rpcUrl ?? mustEnv("RPC_URL"))
}

function contractFor(rpcUrl?: string) {
  const provider = providerFor(rpcUrl)
  const signer = new Wallet(mustEnv("NOTARY_PK"), provider)
  return new Contract(mustEnv("NOTARY_ADDRESS"), NOTARY_ABI, signer)
}

export async function notaryIsNotarized(hashHex: string, rpcUrl?: string) {
  const c = contractFor(rpcUrl)
  const notarized: boolean = await c.isNotarized(hashHex)
  return { notarized }
}

export async function notaryGetRecord(hashHex: string, rpcUrl?: string) {
  const c = contractFor(rpcUrl)
  const [author, timestamp, exists] = await c.getRecord(hashHex)
  return { author: String(author), timestamp: Number(timestamp), exists: Boolean(exists) }
}

export async function notaryNotarize(hashHex: string, rpcUrl?: string) {
  const c = contractFor(rpcUrl)
  const tx = await c.notarize(hashHex)
  const receipt = await tx.wait()
  return { txHash: tx.hash, blockNumber: receipt?.blockNumber ?? null }
}
