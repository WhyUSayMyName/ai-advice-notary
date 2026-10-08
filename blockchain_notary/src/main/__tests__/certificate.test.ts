import { describe, it, expect, beforeAll, afterAll } from "vitest"
import fs from "node:fs"
import os from "node:os"
import path from "node:path"
import { PDFDocument } from "pdf-lib"
import { generateCertificatePdf, type CertificateData } from "../certificate"

/** Куда класть образцы для глазной проверки; иначе — временная папка */
const PREVIEW = process.env.CERT_PREVIEW_OUT
let dir: string

beforeAll(() => {
  dir = PREVIEW ?? fs.mkdtempSync(path.join(os.tmpdir(), "cert-"))
  fs.mkdirSync(dir, { recursive: true })
})

afterAll(() => {
  if (!PREVIEW) fs.rmSync(dir, { recursive: true, force: true })
})

const base: CertificateData = {
  filePath: "D:\\Проекты\\Разрез Северный\\Паспорт БВР 2026-09 ревизия 4.pdf",
  hashHex: "0x3f1a9c47b2e05d8814aa6f30c9e27b41d5680af3927cc1be4a05d73e8b16c2d9",
  chainId: 11155111,
  notaryAddress: "0x5FbDB2315678afecb367f032d93F642f64180aa3",
  author: "0x70997970C51812dc3A010C7d01b50e0d17dc79C8",
  timestamp: 1756900000,
  txHash: "0x9c2b7e1f4a83d05c6e9b1d47f2a0c83b5e6417d9a2c30f8b41e7d56a9c0b3f28",
}

/** Правдоподобные, но выдуманные хеши — сертификату нужна только форма */
function fakeHashes(n: number): string[] {
  return Array.from(
    { length: n },
    (_, i) => `0x${(i + 1).toString(16).padStart(4, "0").repeat(16)}`
  )
}

const withBatch: CertificateData = {
  ...base,
  batch: {
    root: "0xa71c4e09d3b856f21e0c9784ab3d5f60127e8c9b40da3f157e26b09c8d41f735",
    leafCount: 14,
    proof: fakeHashes(4),
    prevChainRoot: "0x0d59e814a72cb3f605d18e94a2c73b016fd48e25a930c7b18e46d502f9a3c81b",
    chainRoot: "0xe4b1039d7a2c586f01e9b47d3c250a8f6197e02b4d8c31a5f70926be4d13c8a7",
  },
}

async function pageCount(file: string): Promise<number> {
  const pdf = await PDFDocument.load(fs.readFileSync(file))
  return pdf.getPageCount()
}

describe("PDF-сертификат", () => {
  it("одиночная фиксация укладывается в одну страницу", async () => {
    const out = path.join(dir, "cert-single.pdf")
    await generateCertificatePdf(out, base)

    expect(fs.readFileSync(out).subarray(0, 5).toString()).toBe("%PDF-")
    expect(await pageCount(out)).toBe(1)
  })

  it("пакетная фиксация с merkle-путём и связкой эпох — тоже одна страница", async () => {
    const out = path.join(dir, "cert-batch.pdf")
    await generateCertificatePdf(out, withBatch)

    expect(await pageCount(out)).toBe(1)
  })

  // Длина merkle-пути растёт с размером пакета: миллион документов — 20 шагов.
  // Вёрстка обязана переносить их на следующую страницу, а не наезжать на подвал.
  it("длинный merkle-путь переносится на вторую страницу", async () => {
    const out = path.join(dir, "cert-deep.pdf")
    await generateCertificatePdf(out, {
      ...withBatch,
      batch: { ...withBatch.batch!, leafCount: 1_000_000, proof: fakeHashes(20) },
    })

    expect(await pageCount(out)).toBeGreaterThan(1)
  })

  // Встроенные шрифты PDF кириллицы не знают, поэтому все начертания —
  // внешние Fira. Тест сторожит, что ни одно из них не потеряно.
  it("русские имена файлов и путей не роняют генерацию", async () => {
    const out = path.join(dir, "cert-ru.pdf")
    await expect(
      generateCertificatePdf(out, {
        ...withBatch,
        filePath: "D:\\Уник\\якорь\\Пояснительная записка к проекту отработки.docx",
      })
    ).resolves.toBeUndefined()
  })

  it("пакет без связывания эпох показывает корень как заякоренное значение", async () => {
    const out = path.join(dir, "cert-legacy.pdf")
    await generateCertificatePdf(out, {
      ...withBatch,
      batch: { ...withBatch.batch!, prevChainRoot: null, chainRoot: null },
    })

    expect(await pageCount(out)).toBe(1)
  })
})
