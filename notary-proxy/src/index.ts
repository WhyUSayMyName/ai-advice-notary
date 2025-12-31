import express from "express";
import dotenv from "dotenv";

dotenv.config();

const app = express();
app.use(express.json());

app.get("/health", (_req, res) => {
  res.json({ ok: true });
});

const PORT = process.env.PORT || 5050;
import { ethers } from "ethers";
import crypto from "crypto";
import AdviceNotaryAbi from "./abi/AdviceNotary.json";

// --- ethers setup ---
const provider = new ethers.JsonRpcProvider(process.env.RPC_URL);
const wallet = new ethers.Wallet(
  process.env.SERVICE_PRIVATE_KEY as string,
  provider
);

const notary = new ethers.Contract(
  process.env.NOTARY_ADDRESS as string,
  AdviceNotaryAbi as any,
  wallet
);

app.post("/notarize", async (req, res) => {
  try {
    const { prompt, answer, model } = req.body ?? {};

    if (typeof prompt !== "string" || typeof answer !== "string") {
      return res.status(400).json({ error: "prompt and answer must be strings" });
    }

    // 1. Хеш диалога
    const recordHash =
      "0x" +
      crypto
        .createHash("sha256")
        .update(prompt + "\n---\n" + answer, "utf8")
        .digest("hex");

    // 2. Хеш метаданных ИИ
    const metaHash =
      "0x" +
      crypto
        .createHash("sha256")
        .update(
          JSON.stringify({
            model: model ?? "unknown",
            ts: Date.now(),
          }),
          "utf8"
        )
        .digest("hex");

    const uri = "local://ai-dialog";

    // 3. Запись в блокчейн
    const tx = await notary.register(recordHash, metaHash, uri);
    const receipt = await tx.wait();

    return res.json({
      ok: true,
      recordHash,
      metaHash,
      txHash: tx.hash,
      blockNumber: receipt.blockNumber,
    });
  } catch (e: any) {
    console.error(e);
    return res.status(500).json({ error: e.message });
  }
});

app.listen(PORT, () => {
  console.log(`Notary Proxy running on http://localhost:${PORT}`);
});
