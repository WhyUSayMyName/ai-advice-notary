import React from "react"

export function Screen({
  title,
  subtitle,
  breadcrumb,
  actions,
  children,
}: {
  title: string
  subtitle?: string
  breadcrumb?: React.ReactNode
  actions?: React.ReactNode
  children: React.ReactNode
}) {
  return (
    <div className="flex min-w-0 flex-1 flex-col">
      <header className="flex shrink-0 items-center gap-3 border-b border-line bg-panel px-5 py-3">
        <div className="min-w-0">
          {breadcrumb ? <div className="text-[12px] text-muted">{breadcrumb}</div> : null}
          <h1 className="truncate text-[15px] font-semibold tracking-[-0.01em]">{title}</h1>
          {subtitle ? <div className="truncate text-[12px] text-muted">{subtitle}</div> : null}
        </div>
        <div className="ml-auto flex shrink-0 items-center gap-2">{actions}</div>
      </header>

      <div className="min-h-0 flex-1 overflow-auto px-5 py-4">
        <div className="mx-auto flex max-w-[1180px] flex-col gap-3.5">{children}</div>
      </div>
    </div>
  )
}
