import fs from "node:fs"
import path from "node:path"
import { PDFDocument, rgb } from "pdf-lib"
import fontkit from "@pdf-lib/fontkit"

export type CertificateData = {
  filePath: string
  hashHex: string
  chainId: number
  rpcUrl: string
  notaryAddress: string
  author: string
  timestamp: number // unix seconds
  txHash: string
}

// dev-путь к шрифту (как у тебя в проекте)
const FONT_PATH = path.resolve(process.cwd(), "src", "assets", "fonts", "arial.ttf")

export async function generateCertificatePdf(outPath: string, data: CertificateData) {
  if (!fs.existsSync(FONT_PATH)) {
    throw new Error(`Font file not found: ${FONT_PATH}`)
  }

  const fontBytes = fs.readFileSync(FONT_PATH)
  const pdfDoc = await PDFDocument.create()
  pdfDoc.registerFontkit(fontkit)

  const font = await pdfDoc.embedFont(fontBytes, { subset: true })

  const page = pdfDoc.addPage([595.28, 841.89]) // A4 in points
  const { width, height } = page.getSize()

  const margin = 50
  let y = height - margin

  const fileName = path.basename(data.filePath)
  const dt = new Date(data.timestamp * 1000)

  const drawText = (text: string, size = 11, opts?: { color?: ReturnType<typeof rgb> }) => {
    page.drawText(text, {
      x: margin,
      y,
      size,
      font,
      color: opts?.color ?? rgb(0, 0, 0),
    })
    y -= size + 6
  }

  const drawTitleCenter = (text: string, size = 20) => {
    const textWidth = font.widthOfTextAtSize(text, size)
    page.drawText(text, {
      x: (width - textWidth) / 2,
      y,
      size,
      font,
      color: rgb(0, 0, 0),
    })
    y -= size + 8
  }

  const drawSubCenter = (text: string, size = 10) => {
    const textWidth = font.widthOfTextAtSize(text, size)
    page.drawText(text, {
      x: (width - textWidth) / 2,
      y,
      size,
      font,
      color: rgb(0.4, 0.4, 0.4),
    })
    y -= size + 10
  }

  // Header
  drawTitleCenter("Blockchain Notary — Certificate", 20)
  drawSubCenter("Proof of existence / notarization record", 10)
  y -= 10

  // Document block
  drawText("Document", 12)
  y -= 2
  drawText(`File name: ${fileName}`, 11)
  drawText(`File path: ${data.filePath}`, 11)
  y -= 10

  // Hash block
  drawText("Hash (SHA-256)", 12)
  y -= 2
  drawText(data.hashHex, 10)
  y -= 10

  // On-chain block
  drawText("On-chain record", 12)
  y -= 2
  drawText(`Chain ID: ${data.chainId}`, 11)
  drawText(`RPC: ${data.rpcUrl}`, 11)
  drawText(`Notary contract: ${data.notaryAddress}`, 11)
  drawText(`Author: ${data.author}`, 11)
  drawText(`Timestamp (local): ${dt.toLocaleString()}`, 11)
  drawText(`Timestamp (unix): ${data.timestamp}`, 11)
  y -= 10

  // Transaction block
  drawText("Transaction", 12)
  y -= 2
  drawText(data.txHash, 10)
  y -= 16

  // Footer note
  const note =
    "This certificate confirms that the hash was recorded on the specified blockchain network.\n" +
    "To verify: recompute SHA-256 of the file and compare it with the hash above, then check the record in the notary contract."

  const noteLines = note.split("\n")
  for (const line of noteLines) {
    drawText(line, 9, { color: rgb(0.4, 0.4, 0.4) })
  }

  // Generated timestamp bottom-right
  const gen = `Generated: ${new Date().toLocaleString()}`
  const genSize = 8
  const genWidth = font.widthOfTextAtSize(gen, genSize)
  page.drawText(gen, {
    x: width - margin - genWidth,
    y: margin - 10,
    size: genSize,
    font,
    color: rgb(0.6, 0.6, 0.6),
  })

  const pdfBytes = await pdfDoc.save()
  fs.writeFileSync(outPath, pdfBytes)
}
