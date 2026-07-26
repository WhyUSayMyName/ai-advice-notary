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
    <div className="flex flex-col items-center justify-center gap-1 px-6 py-14 text-center">
      <div className="text-[13px] text-muted">{title}</div>
      {hint ? <div className="max-w-[46ch] text-[12px] text-faint">{hint}</div> : null}
    </div>
  )
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
