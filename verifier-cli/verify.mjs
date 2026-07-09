#!/usr/bin/env node
/**
 * notary-verify — independent verifier for AI Advice Notary.
 *
 * Recomputes SHA-256 hashes of files and checks them against the on-chain
 * Notary registry. Intentionally minimal and dependency-light (ethers only)
 * so that an external auditor can review this entire file before trusting it.
 *
 * Usage:
 *   notary-verify <file...> --contract 0x... --rpc <url>
 *   notary-verify --bundle evidence.json --dir <documents-dir> --rpc <url>
 *
 * Exit codes: 0 = all checks passed, 1 = usage error, 2 = at least one problem found.
 */

import { createHash } from "node:crypto"
import { readFile } from "node:fs/promises"
import { existsSync } from "node:fs"
import path from "node:path"
import { parseArgs } from "node:util"
import { JsonRpcProvider, Contract, isAddress } from "ethers"

const NOTARY_ABI = [
  "function getRecord(bytes32 hash) view returns (address author, uint256 timestamp, bool exists)",
]

const HELP = `notary-verify — independent verifier for AI Advice Notary

Modes:
  1) Verify individual files against the on-chain registry:
       notary-verify <file...> --contract 0x... --rpc http://127.0.0.1:8545

  2) Verify an evidence bundle exported from the operator's app:
       notary-verify --bundle evidence.json --dir ./documents --rpc <url>
     The contract address is taken from the bundle (override with --contract).

Options:
  -c, --contract <addr>   Notary contract address
  -r, --rpc <url>         JSON-RPC endpoint (use a node you trust!)
  -b, --bundle <file>     evidence bundle JSON (format notary-evidence/v1)
  -d, --dir <dir>         directory with the documents referenced by the bundle
      --json              machine-readable JSON output
  -h, --help              show this help

Verdicts:
  OK_ON_CHAIN      file hash matches the bundle and is anchored on-chain
  NOTARIZED        (file mode) file hash is anchored on-chain
  NOT_FOUND        (file mode) file hash is NOT in the registry
  TAMPERED         file content differs from the hash recorded in the bundle
  MISSING_FILE     bundle references a file that is not in --dir
  NOT_ON_CHAIN     hash matches the bundle but was never anchored on-chain
  LOCAL_ONLY       bundle marks this entry as not notarized (informational)
  OK_HISTORICAL    older version: hash is anchored on-chain (file not checked)
`

async function sha256FileHex(filePath) {
  const buf = await readFile(filePath)
  return "0x" + createHash("sha256").update(buf).digest("hex")
}

function makeGetRecord(rpcUrl, contractAddress) {
  const provider = new JsonRpcProvider(rpcUrl)
  const contract = new Contract(contractAddress, NOTARY_ABI, provider)
  return async (hashHex) => {
    const [author, timestamp, exists] = await contract.getRecord(hashHex)
    return { exists: Boolean(exists), author: String(author), timestamp: Number(timestamp) }
  }
}

function fmtRecord(record) {
  const when = new Date(record.timestamp * 1000).toISOString()
  return `author=${record.author} time=${when}`
}

/** Mode 1: verify individual files. */
async function verifyFiles(files, getRecord) {
  const results = []
  for (const file of files) {
    if (!existsSync(file)) {
      results.push({ file, status: "MISSING_FILE" })
      continue
    }
    const hash = await sha256FileHex(file)
    const record = await getRecord(hash)
    results.push(
      record.exists
        ? { file, hash, status: "NOTARIZED", author: record.author, timestamp: record.timestamp }
        : { file, hash, status: "NOT_FOUND" }
    )
  }
  return results
}

/**
 * Mode 2: verify an evidence bundle.
 *
 * For the latest version of each artifact the file itself is checked
 * (recomputed hash must match the bundle) and the hash must be on-chain.
 * Older versions cannot be compared to a file (the document has legitimately
 * moved on), so only their on-chain anchoring is verified.
 */
async function verifyBundle(bundle, dir, getRecord) {
  if (bundle.format !== "notary-evidence/v1") {
    throw new Error(`Unsupported bundle format: ${bundle.format ?? "(missing)"}`)
  }
  const artifacts = bundle.artifacts ?? []

  const latestVersion = new Map()
  for (const a of artifacts) {
    const cur = latestVersion.get(a.artifact_id) ?? 0
    if (a.version > cur) latestVersion.set(a.artifact_id, a.version)
  }

  const results = []
  for (const a of artifacts) {
    const base = {
      artifact: a.display_name,
      version: a.version,
      file: a.file_name,
      hash: a.hash,
    }
    const isLatest = latestVersion.get(a.artifact_id) === a.version

    if (!a.notarized) {
      results.push({ ...base, status: "LOCAL_ONLY" })
      continue
    }

    const record = await getRecord(a.hash)

    if (!isLatest) {
      results.push(
        record.exists
          ? { ...base, status: "OK_HISTORICAL", author: record.author, timestamp: record.timestamp }
          : { ...base, status: "NOT_ON_CHAIN" }
      )
      continue
    }

    const filePath = path.join(dir, a.file_name)
    if (!existsSync(filePath)) {
      results.push({ ...base, status: "MISSING_FILE" })
      continue
    }

    const actualHash = await sha256FileHex(filePath)
    if (actualHash !== a.hash) {
      results.push({
        ...base,
        status: "TAMPERED",
        actual_hash: actualHash,
        anchored_on_chain: record.exists,
      })
      continue
    }

    results.push(
      record.exists
        ? { ...base, status: "OK_ON_CHAIN", author: record.author, timestamp: record.timestamp }
        : { ...base, status: "NOT_ON_CHAIN" }
    )
  }
  return results
}

const PROBLEM_STATUSES = new Set(["TAMPERED", "MISSING_FILE", "NOT_ON_CHAIN", "NOT_FOUND"])

function printHuman(results) {
  for (const r of results) {
    const name = r.artifact ? `${r.artifact} v${r.version} (${r.file})` : r.file
    let line = `${r.status.padEnd(14)} ${name}`
    if (r.author) line += `  [${fmtRecord(r)}]`
    if (r.status === "TAMPERED") {
      line += `\n${" ".repeat(15)}expected ${r.hash}\n${" ".repeat(15)}actual   ${r.actual_hash}`
      if (r.anchored_on_chain) {
        line += `\n${" ".repeat(15)}the expected hash IS anchored on-chain: the notarized content was modified`
      }
    }
    console.log(line)
  }

  const problems = results.filter((r) => PROBLEM_STATUSES.has(r.status)).length
  console.log(
    `\n${results.length} checked, ${results.length - problems} ok, ${problems} problem(s)`
  )
}

async function main() {
  const { values, positionals } = parseArgs({
    options: {
      contract: { type: "string", short: "c" },
      rpc: { type: "string", short: "r" },
      bundle: { type: "string", short: "b" },
      dir: { type: "string", short: "d" },
      json: { type: "boolean", default: false },
      help: { type: "boolean", short: "h", default: false },
    },
    allowPositionals: true,
  })

  if (values.help || (!values.bundle && positionals.length === 0)) {
    console.log(HELP)
    process.exit(values.help ? 0 : 1)
  }
  if (!values.rpc) {
    console.error("Missing --rpc <url>. Use a JSON-RPC node you trust.")
    process.exit(1)
  }

  let results
  if (values.bundle) {
    const bundle = JSON.parse(await readFile(values.bundle, "utf8"))
    const contractAddress = values.contract ?? bundle.chain?.contract
    if (!contractAddress || !isAddress(contractAddress)) {
      console.error("No valid contract address in bundle or --contract.")
      process.exit(1)
    }
    const dir = values.dir ?? path.dirname(path.resolve(values.bundle))
    results = await verifyBundle(bundle, dir, makeGetRecord(values.rpc, contractAddress))
  } else {
    if (!values.contract || !isAddress(values.contract)) {
      console.error("Missing or invalid --contract <address>.")
      process.exit(1)
    }
    results = await verifyFiles(positionals, makeGetRecord(values.rpc, values.contract))
  }

  if (values.json) {
    console.log(JSON.stringify({ results }, null, 2))
  } else {
    printHuman(results)
  }

  const hasProblems = results.some((r) => PROBLEM_STATUSES.has(r.status))
  process.exit(hasProblems ? 2 : 0)
}

main().catch((e) => {
  console.error(e instanceof Error ? e.message : String(e))
  process.exit(1)
})
