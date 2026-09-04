#!/usr/bin/env node
/**
 * Генератор иконки приложения из фирменного знака.
 *
 * Знак живёт вектором в одном месте (design/brand-identity.html и ui.tsx),
 * поэтому иконка не рисуется руками, а собирается из того же пути: перерисовка
 * знака не оставит за собой расхождения. Промежуточный формат — PDF, потому
 * что pdf-lib уже в зависимостях и умеет рисовать SVG-пути; растеризация
 * делается отдельно, а .ico и .icns из PNG собирает сам electron-builder.
 *
 *   node scripts/make-icon.mjs                     → build/icon.pdf
 *   python -c "import pymupdf; pymupdf.open('build/icon.pdf')[0]  *     .get_pixmap(matrix=pymupdf.Matrix(2,2), alpha=False).save('build/icon.png')"
 *
 * build/icon.png лежит в git: сборка установщика не должна зависеть от
 * наличия Python на машине сборщика.
 */
import fs from "node:fs"
import path from "node:path"
import { fileURLToPath } from "node:url"
import { PDFDocument, rgb } from "pdf-lib"

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..")
const outDir = path.join(root, "build")

const SIGIL =
  "M20 4v32M20 12l9-6M20 12l-9-6M20 22l11-7M20 22L9 15M20 36c-7 0-11-5-12-10M20 36c7 0 11-5 12-10"

const SIZE = 512
// Void и Frost из фирменной палитры (design/tokens.css)
const VOID = rgb(0.027, 0.031, 0.094)
const DEEP = rgb(0.118, 0.137, 0.322)
const FROST = rgb(0.435, 0.816, 0.91)

const pdf = await PDFDocument.create()
const page = pdf.addPage([SIZE, SIZE])

page.drawRectangle({ x: 0, y: 0, width: SIZE, height: SIZE, color: VOID })

// Ореол разлома за древом — единственный источник света в фирменном мире
for (let i = 6; i >= 1; i--) {
  const r = 62 + i * 26
  page.drawCircle({
    x: SIZE / 2,
    y: SIZE * 0.46,
    size: r,
    color: DEEP,
    opacity: 0.13,
  })
}

// Знак: viewBox 40×40, вписан с полями
const scale = (SIZE * 0.62) / 40
page.drawSvgPath(SIGIL, {
  x: (SIZE - 40 * scale) / 2,
  y: SIZE - (SIZE - 40 * scale) / 2,
  scale,
  borderColor: FROST,
  // borderWidth домножается на scale, поэтому задаётся в единицах пути:
  // 1.8 из 40 даёт штрих около 2.7% ширины — читается и в 16 пикселей
  borderWidth: 1.8,
  borderLineCap: 1, // скруглённые окончания: на мелких размерах углы «звенят»
})

fs.mkdirSync(outDir, { recursive: true })
fs.writeFileSync(path.join(outDir, "icon.pdf"), await pdf.save())
console.log(`build/icon.pdf готов (${SIZE}×${SIZE})`)
