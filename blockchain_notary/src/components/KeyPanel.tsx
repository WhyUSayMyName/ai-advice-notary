import { useState } from "react"

const SHORT = (a: string) => `${a.slice(0, 6)}…${a.slice(-4)}`

/**
 * Управление ключом подписи.
 *
 * Ключ никогда не показывается: поле ввода одноразовое, наружу из main
 * приходит только адрес. Правильный путь — создать ключ прямо в хранилище:
 * тогда он не существует нигде, кроме зашифрованного файла. Состояние «ключ
 * лежит в .env» показано тревожным цветом намеренно — это открытый текст на
 * диске, и оператор должен видеть это каждый раз, а не узнать при разборе
 * инцидента.
 */
export function KeyPanel({
  status,
  onSave,
  onGenerate,
  onClear,
}: {
  status: KeyStatus | null
  onSave: (pk: string) => Promise<string | null>
  onGenerate: () => Promise<string | null>
  onClear: () => void
}) {
  const [open, setOpen] = useState(false)
  const [value, setValue] = useState("")
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [justCreated, setJustCreated] = useState(false)
  const [confirmClear, setConfirmClear] = useState(false)
  const [copied, setCopied] = useState(false)

  const save = async () => {
    setBusy(true)
    const err = await onSave(value)
    setBusy(false)
    setError(err)
    if (!err) {
      setValue("")
      setOpen(false)
      setJustCreated(false)
    }
  }

  const generate = async () => {
    setBusy(true)
    const err = await onGenerate()
    setBusy(false)
    setError(err)
    if (!err) setJustCreated(true)
  }

  // Адрес публичен — его можно и нужно копировать, чтобы пополнить
  const copyAddress = async () => {
    if (!status?.address) return
    await navigator.clipboard.writeText(status.address)
    setCopied(true)
    setTimeout(() => setCopied(false), 1500)
  }

  const origin = status?.origin ?? "none"
  const canEncrypt = status ? status.encryptionAvailable : true

  return (
    <div className="space-y-1.5">
      <div className="flex items-center justify-between">
        <div className="text-[10.5px] font-semibold uppercase tracking-[0.09em] text-faint">
          Ключ подписи
        </div>
        {origin !== "none" ? (
          <button
            onClick={() => {
              setOpen((v) => !v)
              setError(null)
            }}
            className="text-[11px] text-muted transition-colors hover:text-ink"
          >
            {open ? "Отмена" : "Заменить"}
          </button>
        ) : null}
      </div>

      {origin === "store" ? (
        <div className="space-y-1">
          <div className="flex items-center gap-1.5 text-[11.5px] text-muted">
            <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-ok shadow-[0_0_0_3px_var(--ok-bg)]" />
            <button
              onClick={() => void copyAddress()}
              title={status?.address ? `${status.address} — скопировать` : undefined}
              className="mono truncate text-ink transition-opacity hover:opacity-80"
            >
              {copied ? "адрес скопирован" : status?.address ? SHORT(status.address) : "сохранён"}
            </button>
            <button
              onClick={() => setConfirmClear(true)}
              title="Удалить ключ из защищённого хранилища"
              className="ml-auto text-[11px] text-muted transition-colors hover:text-err"
            >
              Удалить
            </button>
          </div>

          {justCreated ? (
            <div className="text-[11px] leading-snug text-muted">
              Новый адрес пуст. Скопируйте его и пополните эфиром той сети, куда якорите, — без
              газа фиксации не уйдут.
            </div>
          ) : null}

          {/* Сгенерированный ключ существует только здесь: удаление необратимо */}
          {confirmClear ? (
            <div className="rounded-[var(--radius-s)] bg-err-bg px-2 py-1.5">
              <div className="text-[11px] leading-snug text-err">
                Других копий ключа может не быть. Средства на его адресе станут недоступны
                навсегда.
              </div>
              <div className="mt-1.5 flex gap-3">
                <button
                  onClick={() => {
                    setConfirmClear(false)
                    setJustCreated(false)
                    onClear()
                  }}
                  className="text-[11px] font-medium text-err transition-opacity hover:opacity-80"
                >
                  Удалить безвозвратно
                </button>
                <button
                  onClick={() => setConfirmClear(false)}
                  className="text-[11px] text-muted transition-colors hover:text-ink"
                >
                  Оставить
                </button>
              </div>
            </div>
          ) : null}
        </div>
      ) : null}

      {origin === "env" ? (
        <div className="rounded-[var(--radius-s)] bg-err-bg px-2 py-1.5">
          <div className="text-[11.5px] font-medium text-err">Ключ в .env, открытым текстом</div>
          <div className="mt-0.5 text-[11px] leading-snug text-muted">
            Годится для разработки. Для рабочей установки создайте ключ в хранилище ОС и удалите
            строку из .env.
          </div>
          {status?.address ? (
            <div className="mono mt-1 truncate text-[11px] text-muted">
              {SHORT(status.address)}
            </div>
          ) : null}
          <div className="mt-1.5 flex gap-3">
            <button
              onClick={() => void generate()}
              disabled={busy || !canEncrypt}
              className="text-[11px] font-medium text-accent-hi transition-opacity hover:opacity-80 disabled:opacity-40"
            >
              Создать ключ в хранилище
            </button>
            <button
              onClick={() => setOpen(true)}
              className="text-[11px] text-muted transition-colors hover:text-ink"
            >
              перенести этот
            </button>
          </div>
        </div>
      ) : null}

      {origin === "none" && !open ? (
        <div className="space-y-1">
          <div className="text-[11px] leading-snug text-muted">
            Не задан — фиксации будут копиться в очереди.
          </div>
          <div className="flex items-baseline gap-3">
            <button
              onClick={() => void generate()}
              disabled={busy || !canEncrypt}
              className="text-[11px] font-medium text-accent-hi transition-opacity hover:opacity-80 disabled:opacity-40"
            >
              {busy ? "Создание…" : "Создать ключ"}
            </button>
            <button
              onClick={() => setOpen(true)}
              className="text-[11px] text-muted transition-colors hover:text-ink"
            >
              ввести свой
            </button>
          </div>
          <div className="text-[11px] leading-snug text-faint">
            Ключ создаётся сразу в хранилище ОС и нигде не показывается.
          </div>
        </div>
      ) : null}

      {!canEncrypt ? (
        <div className="text-[11px] leading-snug text-err">
          Система не предоставляет защищённое хранилище — сохранить ключ нельзя.
        </div>
      ) : null}

      {error && !open ? <div className="text-[11px] leading-snug text-err">{error}</div> : null}

      {open ? (
        <div className="space-y-1.5">
          {origin === "store" ? (
            <div className="text-[11px] leading-snug text-err">
              Текущий ключ будет заменён безвозвратно.
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
            disabled={!value || busy || !canEncrypt}
            className="w-full rounded-[var(--radius-s)] bg-accent px-2 py-1.5 text-[11.5px] font-medium text-on-accent transition-opacity hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-40"
          >
            {busy ? "Сохранение…" : "Сохранить"}
          </button>
        </div>
      ) : null}
    </div>
  )
}
