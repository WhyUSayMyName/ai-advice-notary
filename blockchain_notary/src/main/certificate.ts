import "dotenv/config"
import fs from "node:fs"
import path from "node:path"
import PDFDocument from "pdfkit"

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

export async function generateCertificatePdf(outPath: string, data: CertificateData) {
  await new Promise<void>((resolve, reject) => {
    const doc = new PDFDocument({ size: "A4", margin: 50 })
    const stream = fs.createWriteStream(outPath)
    doc.pipe(stream)

    const fileName = path.basename(data.filePath)
    const dt = new Date(data.timestamp * 1000)

    // Header
    doc.fontSize(20).text("Blockchain Notary — Certificate", { align: "center" })
    doc.moveDown(0.5)
    doc.fontSize(10).fillColor("#666").text("Proof of existence / notarization record", { align: "center" })
    doc.moveDown(1.5)
    doc.fillColor("#000")

    // Main info box
    doc.fontSize(12).text("Document", { underline: true })
    doc.moveDown(0.3)
    doc.fontSize(11).text(`File name: ${fileName}`)
    doc.text(`File path: ${data.filePath}`)
    doc.moveDown(0.8)

    doc.fontSize(12).text("Hash (SHA-256)", { underline: true })
    doc.moveDown(0.3)
    doc.font("Courier").fontSize(10).text(data.hashHex, { lineBreak: true })
    doc.font("Helvetica")
    doc.moveDown(0.8)

    doc.fontSize(12).text("On-chain record", { underline: true })
    doc.moveDown(0.3)
    doc.fontSize(11).text(`Chain ID: ${data.chainId}`)
    doc.text(`RPC: ${data.rpcUrl}`)
    doc.text(`Notary contract: ${data.notaryAddress}`)
    doc.text(`Author: ${data.author}`)
    doc.text(`Timestamp (local): ${dt.toLocaleString()}`)
    doc.text(`Timestamp (unix): ${data.timestamp}`)
    doc.moveDown(0.6)

    doc.fontSize(11).text("Transaction", { underline: true })
    doc.moveDown(0.3)
    doc.font("Courier").fontSize(10).text(data.txHash)
    doc.font("Helvetica")
    doc.moveDown(1.2)

    doc.fillColor("#666").fontSize(9).text(
      "This certificate confirms that the hash was recorded on the specified blockchain network.\n" +
        "To verify: recompute SHA-256 of the file and compare with the hash above, then check the record in the contract.",
      { align: "left" }
    )

    // Footer
    doc.moveDown(2)
    doc.fillColor("#999").fontSize(8).text(`Generated: ${new Date().toLocaleString()}`, { align: "right" })

    doc.end()

    stream.on("finish", () => resolve())
    stream.on("error", reject)
  })
}
