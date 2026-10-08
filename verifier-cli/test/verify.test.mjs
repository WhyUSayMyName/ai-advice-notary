/**
 * Tests for notary-verify.
 *
 * They exercise the real CLI exactly as an auditor runs it: `node verify.mjs`
 * as a child process, against a fake JSON-RPC node that serves the registry
 * from an in-memory set. verify.mjs is not imported or modified — the tests
 * guard its observable behaviour (verdicts and exit codes), nothing else.
 *
 * Bundles are hand-crafted here rather than exported by the operator's app:
 * the verifier must not trust that app, and neither should its tests. The
 * canon is pinned by golden vectors that the app's own tests pin as well, so
 * a divergence between the two implementations fails on both sides.
 *
 * Run: node --test   (built-in runner, no extra dependencies)
 */

import { test, describe, before, after } from "node:test"
import assert from "node:assert/strict"
import { createHash } from "node:crypto"
import { createServer } from "node:http"
import { execFile } from "node:child_process"
import { mkdtemp, writeFile, rm } from "node:fs/promises"
import { tmpdir } from "node:os"
import path from "node:path"
import { fileURLToPath } from "node:url"
import { AbiCoder, Interface } from "ethers"

const VERIFY = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "verify.mjs")
const CONTRACT = "0x5FbDB2315678afecb367f032d93F642f64180aa3"
const AUTHOR = "0x70997970C51812dc3A010C7d01b50e0d17dc79C8"
const H = (n) => "0x" + String(n).padStart(64, "0")

// ---------- Canon, reimplemented for the tests ----------

const buf = (hex) => Buffer.from(hex.replace(/^0x/, ""), "hex")
const sha = (...parts) => createHash("sha256").update(Buffer.concat(parts)).digest()
const hex = (b) => "0x" + b.toString("hex")

const leaf = (h) => sha(Buffer.from([0x00]), buf(h))
function node(a, b) {
  const [lo, hi] = Buffer.compare(a, b) <= 0 ? [a, b] : [b, a]
  return sha(Buffer.from([0x01]), lo, hi)
}
const chainRoot = (prev, root) => hex(sha(Buffer.from([0x02]), buf(prev), buf(root)))
const genesis = () => hex(sha(Buffer.from([0x02]), Buffer.from("yggdrasil/chain/v1", "utf8")))
const fileHash = (content) => hex(createHash("sha256").update(content).digest())

/** Two-leaf tree: enough for proofs in both directions. */
function pair(h1, h2) {
  const root = hex(node(leaf(h1), leaf(h2)))
  return { root, proofFor: (h) => [hex(leaf(h === h1 ? h2 : h1))] }
}

// Computed by the operator's app (merkle-core.ts / chain-core.ts) for the
// leaves H(1), H(2), H(3). The same literals are asserted in the app's tests.
const GOLDEN = {
  root: "0x93e34ecb30d456c2bb3903c45dd51d053db3e66522a0a2eaf5fafa58312ed037",
  proofForH2: [
    "0x1fd4247443c9440cb3c48c28851937196bc156032d70a96c98e127ecb347e45f",
    "0xd9cf8add8675a1b25627d7b0ec33bc177cb3930b0b6e995d79c386b980b2f4d6",
  ],
  genesis: "0xc06d7b0c82d4f9a6e767a461f10787d4d6db8703570e9f6613e602ddf259a758",
  head: "0xbab3c3544624d957e6edf40d15dd6e3097aa2189a88663e579236977865f7b3e",
}

// ---------- Fake JSON-RPC node ----------

const registryAbi = new Interface([
  "function getRecord(bytes32 hash) view returns (address author, uint256 timestamp, bool exists)",
])
const coder = AbiCoder.defaultAbiCoder()

/** Values present on-chain; reset by each test. */
let onChain = new Set()

function answer(req) {
  switch (req.method) {
    case "eth_chainId":
      return "0x7a69"
    case "net_version":
      return "31337"
    case "eth_blockNumber":
      return "0x1"
    case "eth_call": {
      const [{ data }] = req.params
      const [hash] = registryAbi.decodeFunctionData("getRecord", data)
      const exists = onChain.has(hash.toLowerCase())
      return coder.encode(
        ["address", "uint256", "bool"],
        exists ? [AUTHOR, 1_700_000_000, true] : ["0x" + "0".repeat(40), 0, false]
      )
    }
    default:
      throw new Error(`fake node: unsupported method ${req.method}`)
  }
}

let server
let rpcUrl

before(async () => {
  server = createServer((req, res) => {
    let body = ""
    req.on("data", (c) => (body += c))
    req.on("end", () => {
      const parsed = JSON.parse(body)
      const one = (r) => {
        try {
          return { jsonrpc: "2.0", id: r.id, result: answer(r) }
        } catch (e) {
          return { jsonrpc: "2.0", id: r.id, error: { code: -32601, message: e.message } }
        }
      }
      res.setHeader("content-type", "application/json")
      res.end(JSON.stringify(Array.isArray(parsed) ? parsed.map(one) : one(parsed)))
    })
  })
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve))
  rpcUrl = `http://127.0.0.1:${server.address().port}`
})

after(() => new Promise((resolve) => server.close(resolve)))

// ---------- Helpers ----------

function run(args) {
  return new Promise((resolve) => {
    execFile(process.execPath, [VERIFY, ...args], { timeout: 20_000 }, (err, stdout, stderr) => {
      resolve({ code: err ? err.code : 0, stdout, stderr })
    })
  })
}

async function runBundle(bundle, files = {}, anchored = []) {
  onChain = new Set(anchored.map((h) => h.toLowerCase()))
  const dir = await mkdtemp(path.join(tmpdir(), "notary-verify-"))
  try {
    for (const [name, content] of Object.entries(files)) {
      await writeFile(path.join(dir, name), content)
    }
    const bundlePath = path.join(dir, "evidence.json")
    await writeFile(bundlePath, JSON.stringify(bundle))
    const { code, stdout, stderr } = await run(["--bundle", bundlePath, "--dir", dir, "--rpc", rpcUrl, "--json"])
    const results = code === 1 ? null : JSON.parse(stdout).results
    return { code, results, stderr }
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
}

const bundleOf = (artifacts, format = "notary-evidence/v3") => ({
  format,
  chain: { chain_id: 31337, contract: CONTRACT, rpc_url_hint: null },
  artifacts,
})

const entry = (over) => ({
  artifact_id: "art-1",
  display_name: "Report",
  version: 1,
  file_name: "report.txt",
  previous_hash: null,
  notarized: true,
  ...over,
})

const statuses = (results) => results.map((r) => r.status)

// ---------- Tests ----------

describe("canon", () => {
  test("test reimplementation agrees with the app's golden vectors", () => {
    assert.equal(genesis(), GOLDEN.genesis)
    assert.equal(chainRoot(GOLDEN.genesis, GOLDEN.root), GOLDEN.head)
  })

  test("verifier folds the app's golden proof through a linked epoch", async () => {
    // v1 is an older version: only its anchoring is checked, so the leaf can
    // be a synthetic hash. v2 is the latest and was never notarized.
    const { code, results } = await runBundle(
      bundleOf([
        entry({
          hash: H(2),
          batch: {
            root: GOLDEN.root,
            proof: GOLDEN.proofForH2,
            prev_chain_root: GOLDEN.genesis,
            chain_root: GOLDEN.head,
          },
        }),
        entry({ version: 2, hash: H(9), previous_hash: H(2), notarized: false }),
      ]),
      {},
      [GOLDEN.head]
    )
    assert.deepEqual(statuses(results), ["OK_HISTORICAL", "LOCAL_ONLY"])
    assert.equal(code, 0)
  })
})

describe("bundle mode", () => {
  const content = "quarterly report\n"
  const h = fileHash(content)

  test("direct anchoring: OK_ON_CHAIN with author and time, exit 0", async () => {
    const { code, results } = await runBundle(bundleOf([entry({ hash: h })]), { "report.txt": content }, [h])
    assert.equal(results[0].status, "OK_ON_CHAIN")
    assert.equal(results[0].author, AUTHOR)
    assert.equal(results[0].timestamp, 1_700_000_000)
    assert.equal(code, 0)
  })

  test("modified file: TAMPERED, and the original hash is shown to be anchored", async () => {
    const { code, results } = await runBundle(
      bundleOf([entry({ hash: h })]),
      { "report.txt": "quarterly report, edited\n" },
      [h]
    )
    assert.equal(results[0].status, "TAMPERED")
    assert.equal(results[0].anchored_on_chain, true)
    assert.equal(results[0].actual_hash, fileHash("quarterly report, edited\n"))
    assert.equal(code, 2)
  })

  test("deleted file: MISSING_FILE, exit 2", async () => {
    const { code, results } = await runBundle(bundleOf([entry({ hash: h })]), {}, [h])
    assert.equal(results[0].status, "MISSING_FILE")
    assert.equal(code, 2)
  })

  test("claimed but never anchored: NOT_ON_CHAIN, exit 2", async () => {
    const { code, results } = await runBundle(bundleOf([entry({ hash: h })]), { "report.txt": content }, [])
    assert.equal(results[0].status, "NOT_ON_CHAIN")
    assert.equal(code, 2)
  })

  test("not notarized: LOCAL_ONLY is informational, exit 0", async () => {
    const { code, results } = await runBundle(
      bundleOf([entry({ hash: h, notarized: false })]),
      { "report.txt": content },
      []
    )
    assert.equal(results[0].status, "LOCAL_ONLY")
    assert.equal(code, 0)
  })

  test("linked batch: the chain head is what must be on-chain, not the root", async () => {
    const other = fileHash("annex\n")
    const tree = pair(h, other)
    const head = chainRoot(genesis(), tree.root)
    const bundle = bundleOf([
      entry({
        hash: h,
        batch: { root: tree.root, proof: tree.proofFor(h), prev_chain_root: genesis(), chain_root: head },
      }),
    ])

    const ok = await runBundle(bundle, { "report.txt": content }, [head])
    assert.equal(ok.results[0].status, "OK_ON_CHAIN")
    assert.equal(ok.code, 0)

    // The bare root on-chain is not enough once the epoch claims a link
    const rootOnly = await runBundle(bundle, { "report.txt": content }, [tree.root])
    assert.equal(rootOnly.results[0].status, "NOT_ON_CHAIN")
    assert.equal(rootOnly.code, 2)
  })

  test("pre-linking batch: the bare root is the anchored value", async () => {
    const tree = pair(h, fileHash("annex\n"))
    const { code, results } = await runBundle(
      bundleOf([entry({ hash: h, batch: { root: tree.root, proof: tree.proofFor(h) } })], "notary-evidence/v2"),
      { "report.txt": content },
      [tree.root]
    )
    assert.equal(results[0].status, "OK_ON_CHAIN")
    assert.equal(code, 0)
  })

  test("proof that does not fold to the root: BAD_PROOF", async () => {
    const tree = pair(h, fileHash("annex\n"))
    const { code, results } = await runBundle(
      bundleOf([entry({ hash: h, batch: { root: tree.root, proof: [H(7)] } })]),
      { "report.txt": content },
      [tree.root]
    )
    assert.equal(results[0].status, "BAD_PROOF")
    assert.equal(code, 2)
  })

  test("head that does not follow from the link: BAD_LINK, even if that head is on-chain", async () => {
    const tree = pair(h, fileHash("annex\n"))
    const forged = H(42)
    const { code, results } = await runBundle(
      bundleOf([
        entry({
          hash: h,
          batch: { root: tree.root, proof: tree.proofFor(h), prev_chain_root: genesis(), chain_root: forged },
        }),
      ]),
      { "report.txt": content },
      [forged]
    )
    assert.equal(results[0].status, "BAD_LINK")
    assert.equal(results[0].computed_chain_root, chainRoot(genesis(), tree.root))
    assert.equal(code, 2)
  })

  test("older versions are checked on-chain only; the latest against the file", async () => {
    const v1 = fileHash("draft\n")
    const bundle = bundleOf([
      entry({ hash: v1 }),
      entry({ version: 2, hash: h, previous_hash: v1 }),
    ])

    const ok = await runBundle(bundle, { "report.txt": content }, [v1, h])
    assert.deepEqual(statuses(ok.results), ["OK_HISTORICAL", "OK_ON_CHAIN"])

    const lostHistory = await runBundle(bundle, { "report.txt": content }, [h])
    assert.deepEqual(statuses(lostHistory.results), ["NOT_ON_CHAIN", "OK_ON_CHAIN"])
    assert.equal(lostHistory.code, 2)
  })

  test("unknown bundle format is refused, not guessed (exit 1)", async () => {
    const { code, stderr } = await runBundle(bundleOf([entry({ hash: h })], "notary-evidence/v99"))
    assert.equal(code, 1)
    assert.match(stderr, /Unsupported bundle format/)
  })
})

describe("file mode", () => {
  test("NOTARIZED and NOT_FOUND per file, exit 2 if any is missing", async () => {
    const dir = await mkdtemp(path.join(tmpdir(), "notary-verify-"))
    try {
      const a = path.join(dir, "a.txt")
      const b = path.join(dir, "b.txt")
      await writeFile(a, "alpha")
      await writeFile(b, "beta")
      onChain = new Set([fileHash("alpha")])

      const { code, stdout } = await run([a, b, "--contract", CONTRACT, "--rpc", rpcUrl, "--json"])
      assert.deepEqual(statuses(JSON.parse(stdout).results), ["NOTARIZED", "NOT_FOUND"])
      assert.equal(code, 2)
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  })

  test("refuses to run without --rpc: the auditor must choose the node", async () => {
    const { code, stderr } = await run(["some.txt", "--contract", CONTRACT])
    assert.equal(code, 1)
    assert.match(stderr, /--rpc/)
  })
})
