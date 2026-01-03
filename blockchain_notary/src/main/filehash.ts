import { createHash } from "node:crypto"
import { readFile } from "node:fs/promises"

export async function sha256FileHex(filePath: string) {
  const buf = await readFile(filePath)
  const hex = createHash("sha256").update(buf).digest("hex")
  return "0x" + hex // 32 bytes => 64 hex chars
}
