import { useState } from "react"

const SHORT = (a: string) => `${a.slice(0, 6)}…${a.slice(-4)}`

/**
 * Управление ключом подписи.
 *
 * Ключ никогда не показывается: поле ввода одноразовое, наружу из main
 * приходит только адрес. Состояние «ключ лежит в .env» показано тревожным
 * цветом намеренно — это открытый текст на диске, и оператор должен видеть
 * это каждый раз, а не узнать при разборе инцидента.
 */
export function KeyPanel({
  status,
  onSave,
  onClear,
}: {
  status: KeyStatus | null
  onSave: (pk: string) => Promise<string | null>
  onClear: () => void
}) {
  const [open, setOpen] = useState(false)
  const [value, setValue] = useState("")
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  const save = async () => {
    setBusy(true)
    const err = await onSave(value)
    setBusy(false)
    setError(err)
    if (!err) {
      setValue("")
      setOpen(false)
    }
  }

  const origin = status?.origin ?? "none"

  return (
    <div className="space-y-1.5">
      <div className="flex items-center justify-between">
        <div className="text-[10.5px] font-semibold uppercase tracking-[0.09em] text-faint">
          Ключ подписи
        </div>
        {origin !== "none" ? (
          <button
            onClick={() => setOpen((v) => !v)}
            className="text-[11px] text-muted transition-colors hover:text-ink"
          >
            {open ? "Отмена" : "Заменить"}
          </button>
        ) : null}
      </div>

      {origin === "store" ? (
        <div className="flex items-center gap-1.5 text-[11.5px] text-muted">
          <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-ok shadow-[0_0_0_3px_var(--ok-bg)]" />
          <span className="mono truncate text-ink">
            {status?.address ? SHORT(status.address) : "сохранён"}
          </span>
          <button
            onClick={onClear}
            title="Удалить ключ из защищённого хранилища"
            className="ml-auto text-[11px] text-muted transition-colors hover:text-err"
          >
            Удалить
          </button>
        </div>
      ) : null}

      {origin === "env" ? (
        <div className="rounded-[var(--radius-s)] bg-err-bg px-2 py-1.5">
          <div className="text-[11.5px] font-medium text-err">Ключ в .env, открытым текстом</div>
          <div className="mt-0.5 text-[11px] leading-snug text-muted">
            Годится для разработки. Для рабочей установки сохраните его в хранилище ОС и удалите
            строку из .env.
          </div>
          {status?.address ? (
            <div className="mono mt-1 truncate text-[11px] text-muted">
              {SHORT(status.address)}
            </div>
          ) : null}
          <button
            onClick={() => setOpen(true)}
            className="mt-1.5 text-[11px] font-medium text-accent-hi transition-opacity hover:opacity-80"
          >
            Перенести в защищённое хранилище
          </button>
        </div>
      ) : null}

      {origin === "none" && !open ? (
        <div className="space-y-1">
          <div className="text-[11px] leading-snug text-muted">
            Не задан — фиксации будут копиться в очереди.
          </div>
          <button
            onClick={() => setOpen(true)}
            className="text-[11px] font-medium text-accent-hi transition-opacity hover:opacity-80"
          >
            Задать ключ
          </button>
        </div>
      ) : null}

      {open ? (
        <div className="space-y-1.5">
          {status && !status.encryptionAvailable ? (
            <div className="text-[11px] leading-snug text-err">
              Система не предоставляет защищённое хранилище — сохранить ключ нельзя.
            </div>
          ) : null}

          <input
            type="password"
            value={value}
            onChange={(e) => {
              setValue(e.target.value)
              setError(null)
            }}
            onKeyDown={(e) => {
              if (e.key === "Enter" && value) void save()
            }}
            placeholder="0x… приватный ключ"
            spellCheck={false}
            autoComplete="off"
            aria-label="Приватный ключ подписанта"
            className="mono w-full rounded-[var(--radius-s)] border border-line bg-panel2 px-2 py-1.5 text-ink outline-none focus:border-accent"
          />

          {error ? <div className="text-[11px] leading-snug text-err">{error}</div> : null}

          <div className="text-[11px] leading-snug text-faint">
            Шифруется средствами ОС и не покидает эту машину.
          </div>

          <button
            onClick={() => void save()}
            disabled={!value || busy || (status ? !status.encryptionAvailable : false)}
            className="w-full rounded-[var(--radius-s)] bg-accent px-2 py-1.5 text-[11.5px] font-medium text-on-accent transition-opacity hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-40"
          >
            {busy ? "Сохранение…" : "Сохранить"}
          </button>
        </div>
      ) : null}
    </div>
  )
}
