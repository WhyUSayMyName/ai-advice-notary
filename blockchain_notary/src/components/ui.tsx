import React from "react"

/** Сокращает хеш до читаемого вида: 0x57ed…3a87 */
export function short(s: string | null | undefined, n = 6) {
  if (!s) return "—"
  if (s.length <= n * 2 + 3) return s
  return `${s.slice(0, n + 2)}…${s.slice(-n)}`
}

export function formatTime(ms: number) {
  return new Date(ms).toLocaleString("ru-RU", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  })
}

type Tone = "ok" | "warn" | "info" | "err" | "mut" | "acc"

const TONE: Record<Tone, string> = {
  ok: "bg-ok-bg text-ok",
  warn: "bg-warn-bg text-warn",
  info: "bg-info-bg text-info",
  err: "bg-err-bg text-err",
  mut: "bg-panel2 text-muted",
  acc: "bg-accent-bg text-accent-hi",
}

/**
 * Статусный бейдж. Точка-индикатор — отдельный элемент фиксированного
 * размера: текст не должен вылезать за подложку ни при какой длине.
 */
export function Pill({ tone = "mut", children }: { tone?: Tone; children: React.ReactNode }) {
  return (
    <span
      className={`inline-flex h-[22px] w-fit items-center gap-1.5 whitespace-nowrap rounded-md px-2.5 text-[11.5px] font-medium ${TONE[tone]}`}
    >
      <i className="h-1.5 w-1.5 shrink-0 rounded-full bg-current" />
      {children}
    </span>
  )
}

export function Chip({ children }: { children: React.ReactNode }) {
  return (
    <span className="inline-flex w-fit items-center gap-1.5 whitespace-nowrap rounded border border-line px-1.5 py-px text-[11px] text-muted">
      {children}
    </span>
  )
}

type ButtonProps = React.ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: "default" | "primary" | "ghost"
}

export function Button({ variant = "default", className = "", ...rest }: ButtonProps) {
  const base =
    "inline-flex items-center gap-2 rounded-[7px] px-3 py-[5px] text-[12.5px] font-medium transition-colors disabled:cursor-not-allowed disabled:opacity-40"
  const styles = {
    default: "border border-line2 bg-panel text-ink hover:bg-panel2",
    primary: "border border-accent bg-accent text-on-accent hover:bg-accent-hi",
    ghost: "border border-transparent text-muted hover:bg-row-hover hover:text-ink",
  }[variant]

  return <button className={`${base} ${styles} ${className}`} {...rest} />
}

export function Card({
  className = "",
  children,
}: {
  className?: string
  children: React.ReactNode
}) {
  return (
    <div className={`overflow-hidden rounded-[9px] border border-line bg-panel ${className}`}>
      {children}
    </div>
  )
}

export function SectionLabel({ children }: { children: React.ReactNode }) {
  return (
    <div className="text-[11px] font-semibold uppercase tracking-[0.08em] text-faint">
      {children}
    </div>
  )
}

export function Stat({
  value,
  label,
  children,
}: {
  value: React.ReactNode
  label: string
  children?: React.ReactNode
}) {
  return (
    <div className="rounded-[9px] border border-line bg-panel px-3.5 pb-2.5 pt-3">
      <div className="num text-[22px] font-semibold leading-none tracking-[-0.02em]">{value}</div>
      <div className="mt-1 text-[11.5px] text-muted">{label}</div>
      {children ? <div className="mt-1.5">{children}</div> : null}
    </div>
  )
}

export function EmptyState({ title, hint }: { title: string; hint?: string }) {
  return (
    <div className="flex flex-col items-center justify-center gap-2 px-6 py-14 text-center">
      <Tree className="text-faint opacity-60" />
      <div className="mt-1 text-[13px] text-muted">{title}</div>
      {hint ? <div className="max-w-[46ch] text-[12px] text-faint">{hint}</div> : null}
    </div>
  )
}

/** Древо: ветви-батчи наверху, ствол-реестр, корень-якорь внизу */
export function Tree({ size = 44, className = "" }: { size?: number; className?: string }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 48 48"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.6"
      strokeLinecap="square"
      className={className}
      aria-hidden="true"
    >
      <path d="M24 6v36" />
      <path d="M24 14l10-7M24 14L14 7M24 24l12-8M24 24L12 16" />
      <path d="M24 42c-8 0-13-6-14-12M24 42c8 0 13-6 14-12" />
      <circle cx="24" cy="5" r="1.6" fill="currentColor" stroke="none" />
    </svg>
  )
}

/**
 * Рунический вордмарк — тот же, что в фирменном стиле, но сплошной заливкой:
 * на малом кегле градиент неразличим, а сплошной штрих избавляет от проблемы
 * нулевого bounding box у буквы I.
 */
export function Wordmark({ width = 132, className = "" }: { width?: number; className?: string }) {
  return (
    <svg
      width={width}
      viewBox="-6 -6 654 112"
      fill="none"
      stroke="currentColor"
      strokeWidth="9"
      strokeLinecap="square"
      strokeLinejoin="miter"
      className={className}
      role="img"
      aria-label="Yggdrasil"
    >
      <g transform="translate(0,0)">
        <path d="M0 0 L30 52 L60 0 M30 52 L30 100" />
      </g>
      <g transform="translate(82,0)">
        <path d="M58 22 L38 2 L20 2 L2 20 L2 80 L20 98 L38 98 L58 78 L58 54 L36 54" />
      </g>
      <g transform="translate(164,0)">
        <path d="M58 22 L38 2 L20 2 L2 20 L2 80 L20 98 L38 98 L58 78 L58 54 L36 54" />
      </g>
      <g transform="translate(246,0)">
        <path d="M4 2 L4 98 M4 2 L34 2 L56 24 L56 76 L34 98 L4 98" />
      </g>
      <g transform="translate(326,0)">
        <path d="M4 2 L4 98 M4 2 L34 2 L54 20 L54 38 L34 56 L4 56 M30 56 L56 98" />
      </g>
      <g transform="translate(404,0)">
        <path d="M2 98 L30 2 L58 98 M14 64 L46 64" />
      </g>
      <g transform="translate(486,0)">
        <path d="M50 18 L36 2 L16 2 L2 18 L2 32 L14 46 L38 54 L50 68 L50 82 L36 98 L16 98 L2 82" />
      </g>
      <g transform="translate(560,0)">
        <path d="M6 2 L6 98" />
      </g>
      <g transform="translate(594,0)">
        <path d="M4 2 L4 98 L46 98" />
      </g>
    </svg>
  )
}

/** Строка рун Старшего Футарка: ᛇᚷᚷᛞᚱᚨᛊᛁᛚ */
export function Runes({ width = 96, className = "" }: { width?: number; className?: string }) {
  return (
    <svg
      width={width}
      viewBox="-3 -3 296 46"
      fill="none"
      stroke="currentColor"
      strokeWidth="3.4"
      strokeLinecap="square"
      className={className}
      aria-hidden="true"
    >
      <g transform="translate(0,0)"><path d="M10 6 L10 34 M10 6 L18 2 M10 34 L2 38" /></g>
      <g transform="translate(30,0)"><path d="M2 2 L26 38 M26 2 L2 38" /></g>
      <g transform="translate(68,0)"><path d="M2 2 L26 38 M26 2 L2 38" /></g>
      <g transform="translate(106,0)"><path d="M3 2 L3 38 M25 2 L25 38 M3 2 L25 38 M3 38 L25 2" /></g>
      <g transform="translate(144,0)"><path d="M4 2 L4 38 M4 2 L20 10 L4 20 M4 20 L20 38" /></g>
      <g transform="translate(178,0)"><path d="M4 2 L4 38 M4 6 L18 14 M4 20 L18 28" /></g>
      <g transform="translate(210,0)"><path d="M18 2 L4 14 L18 26 L4 38" /></g>
      <g transform="translate(242,0)"><path d="M5 2 L5 38" /></g>
      <g transform="translate(262,0)"><path d="M5 2 L5 38 M5 2 L17 14" /></g>
    </svg>
  )
}

/** Имя файла и каталог по отдельности — в реестре путь не должен дублироваться */
export function fileName(p: string) {
  return p.split(/[\\/]/).pop() || p
}

export function fileDir(p: string) {
  const parts = p.split(/[\\/]/)
  parts.pop()
  return parts.join("\\")
}

/** Знак Иггдрасиля: ствол с ветвями и корнями — тот же, что в фирменном стиле */
export function Mark({ size = 20, className = "" }: { size?: number; className?: string }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 40 40"
      fill="none"
      stroke="currentColor"
      strokeWidth="2.6"
      strokeLinecap="square"
      className={className}
      aria-hidden="true"
    >
      <path d="M20 4v32M20 12l9-6M20 12l-9-6M20 22l11-7M20 22L9 15M20 36c-7 0-11-5-12-10M20 36c7 0 11-5 12-10" />
    </svg>
  )
}
