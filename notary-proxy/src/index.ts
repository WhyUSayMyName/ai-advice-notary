import express from "express";
import dotenv from "dotenv";
import { ethers } from "ethers";

import AdviceNotaryArtifact from "./abi/AdviceNotary.json";

dotenv.config();

console.log("INDEX_TS_LOADED", new Date().toISOString());

/**
 * Удобный helper: гарантирует string (а не string|undefined)
 */
function requireEnv(name: string): string {
  const v = process.env[name];
  if (!v || !v.trim()) throw new Error(`ENV ${name} is missing`);
  return v.trim();
}

/**
 * Версии форматов — фиксируем для будущей совместимости
 */
const RECORD_FMT_VERSION = "v1"; // fmt=...
const META_FMT_VERSION = "v1"; // meta=...

/**
 * ENV
 */
const PORT = Number(process.env.PORT || 5050);

const RPC_URL = process.env.RPC_URL?.trim() || "http://127.0.0.1:8545";
const NOTARY_ADDRESS = requireEnv("NOTARY_ADDRESS");
const SERVICE_PRIVATE_KEY = requireEnv("SERVICE_PRIVATE_KEY");

/**
 * Соли: saltId говорит какую соль использовать, а сама соль хранится в переменной вида NOTARY_SALT_<id>
 * Пример:
 *   NOTARY_SALT_ID=v1
 *   NOTARY_SALT_V1=...секрет...
 */
const NOTARY_SALT_ID = (process.env.NOTARY_SALT_ID || "v1").trim();
const saltEnvKey = `NOTARY_SALT_${NOTARY_SALT_ID.toUpperCase()}`; // v1 -> NOTARY_SALT_V1
const NOTARY_SALT = requireEnv(saltEnvKey); // ✅ string (не undefined)

/**
 * Provider / signer / contract
 */
const provider = new ethers.JsonRpcProvider(RPC_URL);
const wallet = new ethers.Wallet(SERVICE_PRIVATE_KEY, provider);

// ABI может быть { abi: [...] } (Hardhat artifacts)
const ABI = (AdviceNotaryArtifact as any).abi ?? AdviceNotaryArtifact;
const notary = new ethers.Contract(NOTARY_ADDRESS, ABI, wallet);

/**
 * Хеш записи (fmt=v1):
 * recordHash = keccak256( "fmt=v1\nsalt=<salt>\nprompt=<prompt>\nanswer=<answer>" )
 *
 * Важно: формат нельзя менять задним числом — иначе verify старых записей сломается.
 */
function hashRecordV1(prompt: string, answer: string, salt: string) {
  const payload = `fmt=${RECORD_FMT_VERSION}\nsalt=${salt}\nprompt=${prompt}\nanswer=${answer}`;
  return ethers.keccak256(ethers.toUtf8Bytes(payload));
}

/**
 * Хеш мета (meta=v1):
 * metaHash = keccak256( "meta=v1\nmodel=<model>" )
 */
function hashMetaV1(model?: string) {
  const m = model && model.trim() ? model.trim() : "unknown";
  const payload = `meta=${META_FMT_VERSION}\nmodel=${m}`;
  return ethers.keccak256(ethers.toUtf8Bytes(payload));
}

/**
 * Упаковываем метаданные в uri (просто удобная строка, пока без IPFS)
 * Пример:
 * inline://salt=v1&fmt=v1&meta=v1&model=demo-llm&ts=123
 */
function makeInlineUri(params: {
  salt: string;
  fmt: string;
  meta: string;
  model: string;
  ts: number;
}) {
  const q = new URLSearchParams({
    salt: params.salt,
    fmt: params.fmt,
    meta: params.meta,
    model: params.model,
    ts: String(params.ts),
  });
  return `inline://${q.toString()}`;
}

const app = express();
app.use(express.json());
app.use(express.static("public"));
app.get("/health", async (_req, res) => {
  try {
    const block = await provider.getBlockNumber();
    res.json({
      ok: true,
      block,
      rpc: RPC_URL,
      notary: NOTARY_ADDRESS,
      signer: wallet.address,
      saltId: NOTARY_SALT_ID,
      fmt: RECORD_FMT_VERSION,
      meta: META_FMT_VERSION,
    });
  } catch (e: any) {
    res.status(500).json({ ok: false, error: e?.message || String(e) });
  }
});

/**
 * POST /notarize
 * body: { prompt: string, answer: string, model?: string }
 *
 * Пишет в блокчейн:
 *  recordHash (с солью)
 *  metaHash   (по модели)
 *  uri        (inline://... с версиями fmt/meta и saltId)
 */
app.post("/notarize", async (req, res) => {
  try {
    const { prompt, answer, model } = req.body ?? {};

    if (typeof prompt !== "string" || typeof answer !== "string") {
      return res.status(400).json({ error: "prompt and answer must be strings" });
    }

    const safeModel = typeof model === "string" && model.trim() ? model.trim() : "unknown";
    const timestamp = Math.floor(Date.now() / 1000);

    // recordHash с солью (salt = секрет)
    const recordHash = hashRecordV1(prompt, answer, NOTARY_SALT);

    // metaHash (пока v1 = model only)
    const metaHash = hashMetaV1(safeModel);

    // uri — фиксируем версии и saltId (критично для будущей совместимости)
    const uri = makeInlineUri({
      salt: NOTARY_SALT_ID,
      fmt: RECORD_FMT_VERSION,
      meta: META_FMT_VERSION,
      model: safeModel,
      ts: timestamp,
    });

    const tx = await notary.register(recordHash, metaHash, uri);
    const receipt = await tx.wait();

    return res.json({
      ok: true,
      recordHash,
      metaHash,
      uri,
      txHash: tx.hash,
      blockNumber: receipt?.blockNumber,
      signer: wallet.address,
    });
  } catch (e: any) {
    return res.status(500).json({
      ok: false,
      error: e?.shortMessage || e?.reason || e?.message || String(e),
    });
  }
});

/**
 * GET /records/:recordHash
 * Читает запись из блокчейна по recordHash
 */
app.get("/records/:recordHash", async (req, res) => {
  try {
    const { recordHash } = req.params;

    if (!/^0x[0-9a-fA-F]{64}$/.test(recordHash)) {
      return res.status(400).json({ error: "recordHash must be bytes32 (0x + 64 hex chars)" });
    }

    const record = await notary.get(recordHash);

    return res.json({
      ok: true,
      recordHash,
      exists: record.exists,
      author: record.author,
      timestamp: record.timestamp?.toString?.() ?? String(record.timestamp),
      metaHash: record.metaHash,
      uri: record.uri,
    });
  } catch (e: any) {
    return res.status(500).json({ error: e.message });
  }
});

/**
 * POST /verify
 * body: { prompt: string, answer: string, model?: string }
 *
 * Делает:
 *  - вычисляет recordHash из prompt+answer+salt
 *  - читает запись из блокчейна
 *  - сравнивает metaHash (модель)
 *
 * Важно: здесь используется ТЕКУЩАЯ соль (NOTARY_SALT_ID/NOTARY_SALT).
 * Если в будущем будет несколько saltId, можно расширить verify: брать saltId из запроса или из uri.
 */
app.post("/verify", async (req, res) => {
  try {
    const { prompt, answer, model } = req.body ?? {};

    if (typeof prompt !== "string" || typeof answer !== "string") {
      return res.status(400).json({ error: "prompt and answer must be strings" });
    }

    const safeModel = typeof model === "string" && model.trim() ? model.trim() : "unknown";

    const recordHash = hashRecordV1(prompt, answer, NOTARY_SALT);
    const expectedMetaHash = hashMetaV1(safeModel);

    const rec = await notary.get(recordHash);
    const exists = Boolean(rec.exists);

    const metaMatches = exists
      ? String(rec.metaHash).toLowerCase() === String(expectedMetaHash).toLowerCase()
      : false;

    return res.json({
      ok: true,
      recordHash,
      exists,
      matches: metaMatches,
      expectedMetaHash,
      onchain: {
        author: rec.author,
        timestamp: rec.timestamp?.toString?.() ?? String(rec.timestamp),
        metaHash: rec.metaHash,
        uri: rec.uri,
      },
      using: {
        saltId: NOTARY_SALT_ID,
        fmt: RECORD_FMT_VERSION,
        meta: META_FMT_VERSION,
        model: safeModel,
      },
    });
  } catch (e: any) {
    return res.status(500).json({ error: e.message });
  }
});

app.listen(PORT, () => {
  console.log(`Notary Proxy running on http://localhost:${PORT}`);
  console.log(`RPC_URL=${RPC_URL}`);
  console.log(`NOTARY_ADDRESS=${NOTARY_ADDRESS}`);
  console.log(`SIGNER=${wallet.address}`);
  console.log(`SALT_ID=${NOTARY_SALT_ID} (env ${saltEnvKey})`);
});
