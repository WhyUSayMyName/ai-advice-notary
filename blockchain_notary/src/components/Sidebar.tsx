import React from "react"
import { Mark, Runes, Wordmark } from "./ui"

export type ScreenId = "registry" | "document" | "audit" | "queue" | "evidence"

const ICONS: Record<ScreenId, React.ReactNode> = {
  registry: (
    <>
      <rect x="2" y="2.5" width="12" height="11" rx="2" />
      <path d="M5 6h6M5 8.5h6M5 11h3.5" />
    </>
  ),
  document: (
    <>
      <path d="M4 1.8h5.5L13 5.3v8a1 1 0 01-1 1H4a1 1 0 01-1-1v-10a1 1 0 011-1z" />
      <path d="M9.5 1.8v3.5H13" />
    </>
  ),
  audit: (
    <>
      <path d="M8 1.8l5 2v3.7c0 3.2-2.1 5.6-5 6.7-2.9-1.1-5-3.5-5-6.7V3.8l5-2z" />
      <path d="M5.8 8l1.6 1.6L10.5 6.5" />
    </>
  ),
  queue: (
    <>
      <path d="M2.5 4.5h11M2.5 8h11M2.5 11.5h7" />
      <circle cx="13" cy="11.5" r="1.6" />
    </>
  ),
  evidence: (
    <>
      <path d="M8 1.6l5.5 2.2v4c0 3.4-2.3 6-5.5 7.2-3.2-1.2-5.5-3.8-5.5-7.2v-4L8 1.6z" />
      <path d="M8 6v4M8 11.6v.6" />
    </>
  ),
}

const NAV: Array<{ id: ScreenId; label: string }> = [
  { id: "registry", label: "Реестр" },
  { id: "document", label: "Документ" },
  { id: "audit", label: "Аудит" },
  { id: "queue", label: "Очередь" },
  { id: "evidence", label: "Доказательства" },
]

export type SidebarProps = {
  screen: ScreenId
  onScreen: (id: ScreenId) => void
  counts: Partial<Record<ScreenId, number>>
  connected: boolean
  netStatus: string
  chainId: number | null
  blockNumber: number | null
  rpcUrl: string
  onRpcUrl: (v: string) => void
  onConnect: () => void
  documentEnabled: boolean
}

export function Sidebar({
  screen,
  onScreen,
  counts,
  connected,
  netStatus,
  chainId,
  blockNumber,
  rpcUrl,
  onRpcUrl,
  onConnect,
  documentEnabled,
}: SidebarProps) {
  return (
    <aside className="relative flex w-[232px] shrink-0 flex-col border-r border-line bg-panel px-2.5 py-3.5">
      {/* Свет разлома за брендовым блоком — единственное место, где мгла
          Иггдрасиля попадает в рабочий интерфейс */}
      <div className="glow pointer-events-none absolute inset-x-0 top-0 h-40" />

      <div className="relative px-2 pb-4 pt-1">
        <div className="flex items-center gap-2.5">
          <div className="flex h-[26px] w-[26px] shrink-0 items-center justify-center rounded-[7px] bg-accent text-on-accent">
            <Mark size={15} />
          </div>
          <Wordmark width={116} className="text-ok" />
        </div>

        <Runes width={84} className="ml-[36px] mt-2 text-faint opacity-70" />

        <div className="ml-[36px] mt-2 flex items-center gap-1.5 text-[11px] text-muted">
          <span className={`h-1.5 w-1.5 shrink-0 rounded-full ${connected ? "bg-ok" : "bg-faint"}`} />
          {connected && blockNumber !== null ? (
            <span className="num truncate">блок {blockNumber.toLocaleString("ru-RU")}</span>
          ) : (
            <span className="truncate">{netStatus}</span>
          )}
        </div>
      </div>

      <nav className="relative flex flex-col gap-px" aria-label="Разделы">
        {NAV.map((item) => {
          const active = screen === item.id
          const disabled = item.id === "document" && !documentEnabled
          const count = counts[item.id]

          return (
            <button
              key={item.id}
              onClick={() => onScreen(item.id)}
              disabled={disabled}
              className={`flex items-center gap-2.5 rounded-[7px] px-2.5 py-1.5 text-[13px] font-medium transition-colors disabled:cursor-not-allowed disabled:opacity-35 ${
                active ? "bg-accent-bg text-ink" : "text-muted hover:bg-row-hover hover:text-ink"
              }`}
            >
              <svg
                viewBox="0 0 16 16"
                fill="none"
                stroke="currentColor"
                strokeWidth="1.4"
                className={`h-4 w-4 shrink-0 ${active ? "text-accent-hi" : "text-faint"}`}
                aria-hidden="true"
              >
                {ICONS[item.id]}
              </svg>
              <span className="truncate">{item.label}</span>
              {count !== undefined && count > 0 ? (
                <span className="num ml-auto text-[11px] text-faint">{count}</span>
              ) : null}
            </button>
          )
        })}
      </nav>

      <div className="relative mt-auto space-y-2 border-t border-line px-2 pt-2.5">
        <div className="text-[10.5px] font-semibold uppercase tracking-[0.09em] text-faint">
          Сеть
        </div>
        <input
          value={rpcUrl}
          onChange={(e) => onRpcUrl(e.target.value)}
          spellCheck={false}
          className="mono w-full rounded-md border border-line bg-panel2 px-2 py-1.5 text-ink outline-none focus:border-accent"
        />
        <div className="flex items-center justify-between gap-2">
          <span className="text-[11.5px] text-muted">
            Chain ID <span className="num text-ink">{chainId ?? "—"}</span>
          </span>
          <button
            onClick={onConnect}
            className="rounded-md border border-line2 px-2 py-1 text-[11.5px] font-medium text-ink transition-colors hover:bg-panel2"
          >
            {connected ? "Обновить" : "Подключить"}
          </button>
        </div>
      </div>
    </aside>
  )
}
