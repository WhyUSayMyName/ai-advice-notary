import fs from "node:fs"
import path from "node:path"
import { PDFDocument, PDFFont, rgb } from "pdf-lib"
import fontkit from "@pdf-lib/fontkit"

export type CertificateBatch = {
  /** Корень merkle-пакета эпохи */
  root: string
  leafCount: number
  /** Хеши-соседи от листа к корню */
  proof: string[]
  /** Голова цепи до эпохи; null у пакетов без связывания */
  prevChainRoot: string | null
  /** Голова цепи после эпохи — заякоренное значение */
  chainRoot: string | null
}

export type CertificateData = {
  filePath: string
  hashHex: string
  chainId: number
  rpcUrl: string
  notaryAddress: string
  author: string
  timestamp: number // unix seconds
  txHash: string
  /** Присутствует, если документ зафиксирован в составе пакета */
  batch?: CertificateBatch
}

/**
 * Палитра для печати — светлый набор из design/tokens.css.
 *
 * Кинематографичная мгла бренда предназначена для экрана. Сертификат печатают:
 * тёмный фон съел бы тонер, а хеши на чёрно-белом принтере стали бы нечитаемы.
 * Поэтому здесь бумажный лист с фирменными акцентами — тот самый лакап
 * «на светлом» из фирменного стиля.
 */
const INK = rgb(0.106, 0.118, 0.239) //#1B1E3D — не чёрный, а брендовый навий
const MUTED = rgb(0.361, 0.384, 0.533) // #5C6288
const FAINT = rgb(0.557, 0.576, 0.706) // #8E93B4
const ACCENT = rgb(0.31, 0.353, 0.796) // #4F5ACB — индиго
const FROST = rgb(0.059, 0.467, 0.569) // #0F7791 — Frost, затемнённый для белого
const FROST_BG = rgb(0.937, 0.976, 0.984)
const HAIRLINE = rgb(0.855, 0.867, 0.925)

const A4: [number, number] = [595.28, 841.89]
const MARGIN = 54
const CONTENT_W = A4[0] - MARGIN * 2

/** Знак Иггдрасиля и рунический вордмарк — те же пути, что в фирменном стиле */
const SIGIL_PATH =
  "M20 4v32M20 12l9-6M20 12l-9-6M20 22l11-7M20 22L9 15M20 36c-7 0-11-5-12-10M20 36c7 0 11-5 12-10"

const WORDMARK: Array<{ dx: number; d: string }> = [
  { dx: 0, d: "M0 0 L30 52 L60 0 M30 52 L30 100" },
  { dx: 82, d: "M58 22 L38 2 L20 2 L2 20 L2 80 L20 98 L38 98 L58 78 L58 54 L36 54" },
  { dx: 164, d: "M58 22 L38 2 L20 2 L2 20 L2 80 L20 98 L38 98 L58 78 L58 54 L36 54" },
  { dx: 246, d: "M4 2 L4 98 M4 2 L34 2 L56 24 L56 76 L34 98 L4 98" },
  { dx: 326, d: "M4 2 L4 98 M4 2 L34 2 L54 20 L54 38 L34 56 L4 56 M30 56 L56 98" },
  { dx: 404, d: "M2 98 L30 2 L58 98 M14 64 L46 64" },
  { dx: 486, d: "M50 18 L36 2 L16 2 L2 18 L2 32 L14 46 L38 54 L50 68 L50 82 L36 98 L16 98 L2 82" },
  { dx: 560, d: "M6 2 L6 98" },
  { dx: 594, d: "M4 2 L4 98 L46 98" },
]

/** Строка рун Старшего Футарка ᛇᚷᚷᛞᚱᚨᛊᛁᛚ */
const RUNES: Array<{ dx: number; d: string }> = [
  { dx: 0, d: "M10 6 L10 34 M10 6 L18 2 M10 34 L2 38" },
  { dx: 30, d: "M2 2 L26 38 M26 2 L2 38" },
  { dx: 68, d: "M2 2 L26 38 M26 2 L2 38" },
  { dx: 106, d: "M3 2 L3 38 M25 2 L25 38 M3 2 L25 38 M3 38 L25 2" },
  { dx: 144, d: "M4 2 L4 38 M4 2 L20 10 L4 20 M4 20 L20 38" },
  { dx: 178, d: "M4 2 L4 38 M4 6 L18 14 M4 20 L18 28" },
  { dx: 210, d: "M18 2 L4 14 L18 26 L4 38" },
  { dx: 242, d: "M5 2 L5 38" },
  { dx: 262, d: "M5 2 L5 38 M5 2 L17 14" },
]

/**
 * Шрифт ищется в нескольких местах: в собранном приложении упаковываются
 * только dist и dist-electron, поэтому src/assets там нет.
 */
function resolveFont(name: string): string {
  const appRoot = process.env.APP_ROOT
  const roots = [
    appRoot ? path.join(appRoot, "dist", "fonts") : null, // собранное приложение
    appRoot ? path.join(appRoot, "public", "fonts") : null, // dev
    path.resolve(process.cwd(), "public", "fonts"),
    path.resolve(process.cwd(), "dist", "fonts"),
  ].filter(Boolean) as string[]

  for (const root of roots) {
    const candidate = path.join(root, name)
    if (fs.existsSync(candidate)) return candidate
  }
  throw new Error(`Шрифт не найден: ${name}. Искали в: ${roots.join(", ")}`)
}

/** Разбивает hex на группы — так его читают и сверяют глазами */
function groupHex(hex: string, size = 8): string {
  const body = hex.startsWith("0x") ? hex.slice(2) : hex
  return (body.match(new RegExp(`.{1,${size}}`, "g")) ?? []).join(" ")
}

function wrap(text: string, font: PDFFont, size: number, maxWidth: number): string[] {
  const words = text.split(/\s+/)
  const lines: string[] = []
  let line = ""

  for (const word of words) {
    const candidate = line ? `${line} ${word}` : word
    if (font.widthOfTextAtSize(candidate, size) <= maxWidth) {
      line = candidate
    } else {
      if (line) lines.push(line)
      line = word
    }
  }
  if (line) lines.push(line)
  return lines
}

/** Обрезает слишком длинную строку (пути к файлам бывают безумными) */
function ellipsize(text: string, font: PDFFont, size: number, maxWidth: number): string {
  if (font.widthOfTextAtSize(text, size) <= maxWidth) return text
  let s = text
  while (s.length > 8 && font.widthOfTextAtSize(`…${s}`, size) > maxWidth) {
    s = s.slice(1)
  }
  return `…${s}`
}

export async function generateCertificatePdf(outPath: string, data: CertificateData) {
  const pdf = await PDFDocument.create()
  pdf.registerFontkit(fontkit)

  // Fira Sans / Fira Mono (OFL 1.1): свободны для распространения и покрывают
  // кириллицу — в отличие от встроенных шрифтов PDF, у которых её нет вовсе.
  const embed = (file: string) =>
    pdf.embedFont(fs.readFileSync(resolveFont(file)), { subset: true })

  const regular = await embed("FiraSans-Regular.ttf")
  const bold = await embed("FiraSans-SemiBold.ttf")
  const mono = await embed("FiraMono-Regular.ttf")
  const monoBold = await embed("FiraMono-Medium.ttf")

  /** Низ полосы набора: ниже начинается подвал */
  const FLOOR = MARGIN + 54

  /**
   * Древо-подложка: очень светлый знак во всю нижнюю половину листа.
   * Рисуется первым, поэтому текст всегда поверх; тонкая линия почти не ест тонер.
   */
  const startPage = () => {
    const p = pdf.addPage(A4)
    const scale = 8.2
    p.drawSvgPath(SIGIL_PATH, {
      x: (A4[0] - 40 * scale) / 2,
      y: A4[1] * 0.62,
      scale,
      borderColor: rgb(0.965, 0.968, 0.987),
      borderWidth: 1,
    })
    return p
  }

  let page = startPage()
  let y = A4[1] - MARGIN

  /** Перенос на новую страницу, если запрошенный блок не влезает целиком */
  const ensure = (needed: number) => {
    if (y - needed >= FLOOR) return
    page = startPage()
    y = A4[1] - MARGIN
    // Тонкая шапка продолжения: знак без вордмарка
    page.drawSvgPath(SIGIL_PATH, {
      x: MARGIN,
      y,
      scale: 0.34,
      borderColor: ACCENT,
      borderWidth: 1.2,
    })
    page.drawText("Свидетельство о фиксации документа (продолжение)", {
      x: MARGIN + 22,
      y: y - 10,
      size: 8,
      font: regular,
      color: FAINT,
    })
    y -= 26
  }

  const text = (
    s: string,
    opts: {
      size?: number
      font?: PDFFont
      color?: ReturnType<typeof rgb>
      x?: number
      spacing?: number
    } = {}
  ) => {
    const size = opts.size ?? 10
    ensure(size + 2)
    page.drawText(s, {
      x: opts.x ?? MARGIN,
      y,
      size,
      font: opts.font ?? regular,
      color: opts.color ?? INK,
    })
    y -= size + (opts.spacing ?? 5)
  }

  /** Абзац с переносом по ширине полосы */
  const para = (
    s: string,
    opts: { size?: number; color?: ReturnType<typeof rgb>; spacing?: number } = {}
  ) => {
    const size = opts.size ?? 9
    const lines = wrap(s, regular, size, CONTENT_W)
    ensure(lines.length * (size + 3))
    for (const line of lines) {
      page.drawText(line, { x: MARGIN, y, size, font: regular, color: opts.color ?? INK })
      y -= size + 3
    }
    y -= opts.spacing ?? 7
  }

  const rule = (color = HAIRLINE, gap = 12) => {
    y -= gap * 0.4
    page.drawLine({
      start: { x: MARGIN, y },
      end: { x: MARGIN + CONTENT_W, y },
      thickness: 0.7,
      color,
    })
    y -= gap
  }

  const label = (s: string) => {
    // Заголовок раздела не должен остаться один внизу страницы
    ensure(34)
    text(s.toUpperCase(), { size: 7.5, font: bold, color: FAINT, spacing: 7 })
  }

  /** Пара «подпись — значение» в две колонки */
  const field = (name: string, value: string, opts: { mono?: boolean } = {}) => {
    ensure(15)
    page.drawText(name, { x: MARGIN, y, size: 9, font: regular, color: MUTED })
    page.drawText(value, {
      x: MARGIN + 150,
      y,
      size: opts.mono ? 9.5 : 9.5,
      font: opts.mono ? mono : regular,
      color: INK,
    })
    y -= 14
  }

  /**
   * Значение-хеш: печатается целиком и никогда не обрезается — по нему сверяют.
   * Кегль подбирается под ширину колонки, а не наоборот.
   */
  const hashField = (name: string, value: string) => {
    const shown = groupHex(value, 16)
    let size = 9
    while (size > 6 && mono.widthOfTextAtSize(shown, size) > CONTENT_W - 150) size -= 0.25
    ensure(15)
    page.drawText(name, { x: MARGIN, y, size: 9, font: regular, color: MUTED })
    page.drawText(shown, { x: MARGIN + 150, y, size, font: mono, color: INK })
    y -= 14
  }

  /**
   * Схема связки эпох: голова цепи считается из предыдущей головы и корня пакета.
   * Аудитор должен видеть, ПОЧЕМУ в реестре лежит не корень, а голова.
   */
  const drawChainDiagram = (prev: string | null, root: string, head: string) => {
    const boxH = 30
    const gap = 22
    const boxW = (CONTENT_W - gap * 2) / 3
    ensure(boxH + 40)

    text("Связка эпох", { size: 8.5, font: bold, color: FAINT, spacing: 6 })
    const top = y
    const cells: Array<{ cap: string; hex: string; accent: boolean }> = [
      { cap: prev ? "предыдущая голова" : "начало цепи", hex: prev ?? "—", accent: false },
      { cap: "корень этой эпохи", hex: root, accent: false },
      { cap: "голова цепи → в реестр", hex: head, accent: true },
    ]

    cells.forEach((cell, i) => {
      const x = MARGIN + i * (boxW + gap)
      page.drawRectangle({
        x,
        y: top - boxH,
        width: boxW,
        height: boxH,
        color: cell.accent ? FROST_BG : rgb(1, 1, 1),
        borderColor: cell.accent ? FROST : HAIRLINE,
        borderWidth: cell.accent ? 1 : 0.7,
      })
      page.drawText(cell.cap, {
        x: x + 8,
        y: top - 12,
        size: 6.5,
        font: regular,
        color: cell.accent ? FROST : FAINT,
      })
      const shownHex = cell.hex === "—" ? "—" : `${cell.hex.slice(0, 10)}…${cell.hex.slice(-6)}`
      page.drawText(shownHex, { x: x + 8, y: top - 23, size: 7.5, font: mono, color: INK })

      if (i < cells.length - 1) {
        const ax = x + boxW
        page.drawLine({
          start: { x: ax + 4, y: top - boxH / 2 },
          end: { x: ax + gap - 6, y: top - boxH / 2 },
          thickness: 0.8,
          color: FAINT,
        })
        page.drawSvgPath("M0 0 L5 4 L0 8", {
          x: ax + gap - 9,
          y: top - boxH / 2 + 4,
          borderColor: FAINT,
          borderWidth: 0.8,
        })
      }
    })

    y = top - boxH - 10
    page.drawText("голова цепи = SHA-256( 0x02 || предыдущая голова || корень эпохи )", {
      x: MARGIN,
      y,
      size: 7.5,
      font: regular,
      color: MUTED,
    })
    y -= 18
  }

  // ---------- Шапка: знак, вордмарк, руны ----------
  const headerTop = y
  page.drawSvgPath(SIGIL_PATH, {
    x: MARGIN,
    y: headerTop + 2,
    scale: 0.78,
    borderColor: ACCENT,
    borderWidth: 1.6,
  })

  const wmX = MARGIN + 42
  const wmScale = 0.185
  for (const letter of WORDMARK) {
    page.drawSvgPath(letter.d, {
      x: wmX + letter.dx * wmScale,
      y: headerTop,
      scale: wmScale,
      borderColor: INK,
      borderWidth: 1.6,
    })
  }

  // Руны идут строкой под вордмарком, растянутые на его ширину
  const runeScale = 0.26
  for (const [i, rune] of RUNES.entries()) {
    page.drawSvgPath(rune.d, {
      x: wmX + rune.dx * runeScale + i * 1.5,
      y: headerTop - 27,
      scale: runeScale,
      borderColor: FAINT,
      borderWidth: 0.9,
    })
  }

  // Кеннинг справа — фирменная строка, набранная разрядкой
  const kenning = "WHAT IS ANCHORED CANNOT BE UNMADE"
  page.drawText(kenning, {
    x: MARGIN + CONTENT_W - regular.widthOfTextAtSize(kenning, 6.5),
    y: headerTop - 6,
    size: 6.5,
    font: regular,
    color: FROST,
  })

  y = headerTop - 48
  rule(ACCENT, 20)

  // ---------- Заголовок ----------
  text("Свидетельство о фиксации документа", { size: 17, font: bold, spacing: 6 })
  para(
    "Подтверждает, что хеш документа зафиксирован во внешнем реестре и не может быть изменён задним числом.",
    { color: MUTED, spacing: 12 }
  )

  // ---------- Документ ----------
  label("Документ")
  text(path.basename(data.filePath), { size: 12, font: bold, spacing: 4 })
  text(ellipsize(path.dirname(data.filePath), regular, 8.5, CONTENT_W), {
    size: 8.5,
    color: MUTED,
    spacing: 12,
  })

  // ---------- Хеш ----------
  ensure(58)
  label("SHA-256 документа")
  const hashBoxTop = y + 4
  const grouped = groupHex(data.hashHex)
  const hashSize = 11
  const hashWidth = monoBold.widthOfTextAtSize(grouped, hashSize)
  const hashBoxH = 34

  page.drawRectangle({
    x: MARGIN,
    y: hashBoxTop - hashBoxH,
    width: CONTENT_W,
    height: hashBoxH,
    color: FROST_BG,
    borderColor: HAIRLINE,
    borderWidth: 0.7,
  })
  page.drawText(grouped, {
    x: MARGIN + (CONTENT_W - hashWidth) / 2,
    y: hashBoxTop - hashBoxH / 2 - hashSize / 3,
    size: hashSize,
    font: monoBold,
    color: INK,
  })
  y = hashBoxTop - hashBoxH - 20

  // ---------- Фиксация ----------
  const anchored = data.batch?.chainRoot ?? data.batch?.root ?? data.hashHex
  const anchoredKind = data.batch
    ? data.batch.chainRoot
      ? "голова цепи эпох"
      : "корень пакета"
    : "хеш документа"

  label("Фиксация во внешнем реестре")
  if (data.batch) {
    hashField("Заякоренное значение", anchored)
    field("Что именно заякорено", anchoredKind)
  } else {
    // Повторять тот же хеш второй раз незачем — важно лишь, что в реестре именно он
    field("Заякоренное значение", "хеш документа, приведённый выше")
  }
  hashField("Транзакция", data.txHash)
  field("Контракт реестра", data.notaryAddress, { mono: true })
  field("Сеть (chain ID)", String(data.chainId))
  field("Отправитель записи", data.author, { mono: true })
  field(
    "Момент фиксации",
    `${new Date(data.timestamp * 1000).toLocaleString("ru-RU")} (unix ${data.timestamp})`
  )
  y -= 6

  // ---------- Эпоха и путь доказательства ----------
  if (data.batch) {
    label("Пакетная фиксация")
    para(
      `Документ зафиксирован в составе эпохи из ${data.batch.leafCount} документов — ` +
        `одной транзакцией на всех. Поэтому самого хеша документа в реестре нет: ` +
        `там лежит ${anchoredKind}, а связь с документом восстанавливается по merkle-пути ниже.`,
      { color: MUTED, spacing: 10 }
    )

    hashField("Корень пакета", data.batch.root)
    if (data.batch.prevChainRoot) {
      hashField("Предыдущая эпоха", data.batch.prevChainRoot)
    }

    if (data.batch.proof.length > 0) {
      y -= 2
      text(`Merkle-путь от документа к корню (${data.batch.proof.length} шагов):`, {
        size: 8.5,
        color: MUTED,
        spacing: 7,
      })
      for (const [i, step] of data.batch.proof.entries()) {
        ensure(11)
        page.drawText(`${i + 1}.`, { x: MARGIN, y, size: 7.5, font: regular, color: FAINT })
        page.drawText(groupHex(step, 16), {
          x: MARGIN + 16,
          y,
          size: 7.5,
          font: mono,
          color: INK,
        })
        y -= 10.5
      }
    }
    y -= 10

    if (data.batch.chainRoot) {
      drawChainDiagram(data.batch.prevChainRoot, data.batch.root, data.batch.chainRoot)
    }
  }

  // ---------- Как проверить ----------
  label("Как проверить это свидетельство")
  const steps = [
    "Вычислите SHA-256 документа и сравните со значением выше — оно должно совпасть побайтно.",
    data.batch
      ? "Сверните merkle-путь от хеша документа к корню пакета, затем получите заякоренное значение."
      : "Найдите хеш документа в контракте реестра методом getRecord.",
    "Проверьте заякоренное значение в контракте через RPC-узел, которому доверяете вы, а не оператор.",
    "Адрес контракта получите из независимого источника — не только из этого листа.",
  ]

  for (const [i, step] of steps.entries()) {
    const lines = wrap(step, regular, 9, CONTENT_W - 18)
    ensure(lines.length * 12 + 4)
    page.drawText(`${i + 1}`, { x: MARGIN + 2, y, size: 9, font: bold, color: ACCENT })
    for (const [li, line] of lines.entries()) {
      page.drawText(line, {
        x: MARGIN + 18,
        y: y - li * 12,
        size: 9,
        font: regular,
        color: INK,
      })
    }
    y -= lines.length * 12 + 3
  }

  y -= 6
  text("Открытый верификатор: verifier-cli в репозитории проекта", {
    size: 8.5,
    color: MUTED,
    spacing: 8,
  })

  // ---------- Оговорка (на последней странице, сразу под текстом) ----------
  const disclaimerLines = wrap(
    "Доказательством является запись во внешнем реестре, а не этот лист: свидетельство лишь " +
      "указывает, где и что проверять. Система обнаруживает подмену и уничтожение данных постфактум, " +
      "но не предотвращает их и не подтверждает авторство документа.",
    regular,
    7.5,
    CONTENT_W
  )

  // Печатается в зарезервированной нижней полосе последней страницы —
  // FLOOR не пускает туда основной текст, поэтому наложения не будет.
  let fy = MARGIN + 46
  page.drawLine({
    start: { x: MARGIN, y: fy },
    end: { x: MARGIN + CONTENT_W, y: fy },
    thickness: 0.7,
    color: HAIRLINE,
  })
  fy -= 12
  for (const line of disclaimerLines) {
    page.drawText(line, { x: MARGIN, y: fy, size: 7.5, font: regular, color: MUTED })
    fy -= 10
  }

  // ---------- Колонтитул на каждой странице ----------
  const stamp = `Иггдрасиль · сформировано ${new Date().toLocaleString("ru-RU")}`
  const pages = pdf.getPages()
  pages.forEach((p, i) => {
    p.drawText(stamp, { x: MARGIN, y: MARGIN - 16, size: 7, font: regular, color: FAINT })
    if (pages.length > 1) {
      const num = `${i + 1} / ${pages.length}`
      p.drawText(num, {
        x: MARGIN + CONTENT_W - regular.widthOfTextAtSize(num, 7),
        y: MARGIN - 16,
        size: 7,
        font: regular,
        color: FAINT,
      })
    }
  })

  fs.writeFileSync(outPath, await pdf.save())
}
