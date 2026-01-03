import React, { useMemo, useState } from "react"

function short(s: string, n = 10) {
  if (!s) return s
  if (s.length <= n * 2 + 3) return s
  return `${s.slice(0, n)}…${s.slice(-n)}`
}

export default function App() {
  // Network
  const [rpcUrl, setRpcUrl] = useState("http://127.0.0.1:8545")
  const [netStatus, setNetStatus] = useState("Отключено")
  const [chainId, setChainId] = useState<number | null>(null)
  const [blockNumber, setBlockNumber] = useState<number | null>(null)

  // Notary
const [filePath, setFilePath] = useState<string>("")
const [hashHex, setHashHex] = useState<string>("")
const [txHash, setTxHash] = useState<string>("")
const [notarized, setNotarized] = useState<boolean | null>(null)
const [record, setRecord] = useState<{ author: string; timestamp: number } | null>(null)


  // Logs
  const [logs, setLogs] = useState<string[]>([])
  const log = (msg: string) =>
    setLogs((l) => [`[${new Date().toLocaleTimeString()}] ${msg}`, ...l])

  const canCheck = hashHex.startsWith("0x") && hashHex.length === 66
const canNotarize = canCheck && notarized === false

  const tsHuman = useMemo(() => {
    if (!record?.timestamp) return null
    return new Date(record.timestamp * 1000).toLocaleString()
  }, [record])

  const connect = async () => {
    log(`Подключение к ${rpcUrl}`)
    setNetStatus("Подключение…")

    const res = await window.api.connectRpc(rpcUrl)

    if (res.ok) {
      setChainId(res.chainId ?? null)
      setBlockNumber(res.blockNumber ?? null)
      setNetStatus("Подключено")
      log(`OK: chainId=${res.chainId}, block=${res.blockNumber}`)
    } else {
      setNetStatus("Ошибка")
      log(`Ошибка: ${res.error}`)
    }
  }

  const check = async () => {
    if (!canCheck) return

    log(`Проверка в контракте: ${hashHex}`)
    const r = await window.api.notaryIsNotarized(hashHex, rpcUrl)
    if (!r.ok) {
      log(`Ошибка: ${r.error}`)
      return
    }

    const isN = Boolean(r.notarized)
    setNotarized(isN)
    log(isN ? "Уже нотариально записан ✅" : "Ещё не записан ❌")

    if (isN) {
      const rr = await window.api.notaryGetRecord(hashHex, rpcUrl)
      if (rr.ok && rr.exists) {
        setRecord({ author: rr.author ?? "", timestamp: rr.timestamp ?? 0 })
        log(`Record: author=${rr.author}, ts=${rr.timestamp}`)
      }
    } else {
      setRecord(null)
    }
  }

  const notarizeNow = async () => {
    if (!canCheck) return

    log(`Нотариат: отправка TX для ${hashHex}`)
    const r = await window.api.notaryNotarize(hashHex, rpcUrl)
    if (!r.ok) {
      log(`Ошибка TX: ${r.error}`)
      return
    }

    log(`TX OK: ${r.txHash} (block ${r.blockNumber})`)
    await check()
  }
  const savePdf = async () => {
  if (!filePath || !hashHex || !record || !txHash) {
    log("Для PDF нужны: файл, hash, record (author/timestamp) и txHash")
    return
  }

  log("Сохранение PDF…")
  const res = await window.api.saveCertificatePdf({
    filePath,
    hashHex,
    rpcUrl,
    author: record.author,
    timestamp: record.timestamp,
    txHash,
  })

  if (res.ok) log(`PDF сохранён: ${res.filePath}`)
  else if (res.canceled) log("Сохранение отменено")
  else log(`Ошибка PDF: ${res.error}`)
}


  const pickFile = async () => {
    log("Выбор файла…")
    const res = await window.api.pickAndHash()
    if (!res.ok) {
      if (res.canceled) log("Отменено пользователем")
      else log(`Ошибка выбора файла: ${res.error}`)
      return
    }

    setFilePath(res.filePath ?? "")
    setHashHex(res.hashHex ?? "")
    setNotarized(null)
    setRecord(null)

    log(`Файл: ${res.filePath}`)
    log(`SHA-256: ${res.hashHex}`)

    // ✅ Автопроверка сразу после выбора
    await check()
  }

  const handleDragOver = (ev: React.DragEvent<HTMLDivElement>) => {
    ev.preventDefault()
  }

  const handleDrop = async (ev: React.DragEvent<HTMLDivElement>) => {
    ev.preventDefault()
    const f = ev.dataTransfer.files?.[0]
    if (!f) return

    // В Electron у объекта File есть path
    type ElectronFile = File & { path?: string }
const filePathDropped = (f as ElectronFile).path

    if (!filePathDropped) {
      log("Не удалось получить путь файла (drop)")
      return
    }

    log(`Drop: ${filePathDropped}`)
    const res = await window.api.hashPath(filePathDropped)
    if (!res.ok) {
      log(`Ошибка hashPath: ${res.error}`)
      return
    }

    setFilePath(res.filePath ?? filePathDropped)
    setHashHex(res.hashHex ?? "")
    setNotarized(null)
    setRecord(null)

    log(`SHA-256: ${res.hashHex}`)
    setTxHash("")
    await check()

  }

  return (
    <div className="min-h-screen bg-zinc-50 p-6">
      <div className="mx-auto max-w-5xl space-y-6">
        <header className="flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-semibold text-zinc-900">Blockchain Notary</h1>
            <p className="text-sm text-zinc-600">Файл → SHA-256 → Смарт-контракт</p>
          </div>
          <div className="text-xs text-zinc-500">Hardhat chainId 31337</div>
        </header>

        {/* Network + Logs */}
        <div className="grid grid-cols-1 gap-6 md:grid-cols-2">
          <div className="rounded-2xl border border-zinc-200 bg-white p-5 shadow-sm">
            <div className="text-sm font-medium text-zinc-900">RPC подключение</div>
            <div className="mt-3 flex gap-3">
              <input
                className="flex-1 rounded-xl border border-zinc-200 px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-zinc-200"
                value={rpcUrl}
                onChange={(e) => setRpcUrl(e.target.value)}
              />
              <button
                className="rounded-2xl bg-black px-4 py-2 text-sm font-medium text-white hover:opacity-90 active:scale-[0.99]"
                onClick={connect}
              >
                Connect
              </button>
            </div>

            <div className="mt-4 text-sm text-zinc-800">
              <div className="text-sm font-medium text-zinc-900">Статус сети</div>
              <div className="mt-1 text-sm text-zinc-600">{netStatus}</div>
              <div className="mt-3 space-y-1">
                <div>Chain ID: {chainId ?? "—"}</div>
                <div>Block number: {blockNumber ?? "—"}</div>
              </div>
            </div>
          </div>

          <div className="rounded-2xl border border-zinc-200 bg-white p-5 shadow-sm">
            <div className="text-sm font-medium text-zinc-900">Логи</div>
            <div className="mt-3 h-56 overflow-auto rounded-xl bg-zinc-100 p-2 font-mono text-xs text-zinc-900">
              {logs.length === 0 ? (
                <div className="text-zinc-500">Пока пусто…</div>
              ) : (
                logs.map((l, i) => <div key={i}>{l}</div>)
              )}
            </div>
          </div>
        </div>

        {/* Notary */}
        <div className="rounded-2xl border border-zinc-200 bg-white p-5 shadow-sm">
          <div className="flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
            <div>
              <div className="text-sm font-medium text-zinc-900">Нотариат</div>
              <div className="text-sm text-zinc-600">Выбери файл или перетащи его сюда</div>
            </div>

            <div className="flex flex-wrap gap-3">
  {/* Выбрать файл */}
  <button
    onClick={pickFile}
    className="rounded-xl bg-black px-4 py-2 text-sm font-medium text-white"
  >
    Выбрать файл
  </button>

  {/* Check */}
  <button
    onClick={check}
    disabled={!canCheck}
    className="rounded-xl border px-4 py-2 text-sm disabled:opacity-40"
  >
    Check
  </button>

  {/* Notarize — 🔥 ВОТ ЕЁ НЕ ХВАТАЛО */}
  <button
    onClick={notarizeNow}
    disabled={!canNotarize}
    className="rounded-xl bg-emerald-600 px-4 py-2 text-sm font-medium text-white disabled:opacity-40"
  >
    Notarize
  </button>

  {/* PDF */}
  <button
    onClick={savePdf}
    disabled={!record}
    className="rounded-xl border px-4 py-2 text-sm disabled:opacity-40"
  >
    Сохранить PDF
  </button>
</div>


          </div>

          <div
            onDrop={handleDrop}
            onDragOver={handleDragOver}
            className="mt-4 rounded-2xl border border-dashed border-zinc-300 bg-zinc-50 p-4 text-sm text-zinc-700"
          >
            Перетащи файл сюда или нажми “Выбрать файл”
          </div>

          <div className="mt-4 grid grid-cols-1 gap-4 md:grid-cols-2">
            <div className="rounded-2xl bg-zinc-50 p-4">
              <div className="text-xs text-zinc-500">Файл</div>
              <div className="mt-1 break-all text-sm text-zinc-900">{filePath || "—"}</div>
            </div>

            <div className="rounded-2xl bg-zinc-50 p-4">
              <div className="text-xs text-zinc-500">SHA-256 (bytes32)</div>
              <div className="mt-1 break-all font-mono text-sm text-zinc-900">{hashHex || "—"}</div>

              <div className="mt-2 text-xs text-zinc-600">
                Статус:{" "}
                {notarized === null ? (
                  "—"
                ) : notarized ? (
                  <span className="font-medium text-green-700">Нотариально записан</span>
                ) : (
                  <span className="font-medium text-red-700">Не записан</span>
                )}
              </div>

              {record && (
                <div className="mt-2 text-xs text-zinc-700">
                  <div>
                    Автор: <span className="font-mono">{short(record.author)}</span>
                  </div>
                  <div>Время: {tsHuman}</div>
                </div>
              )}
            </div>
          </div>
        </div>

        <div className="text-xs text-zinc-500">
          Примечание: для записи нужен приватный ключ из Hardhat (Account #0) в{" "}
          <span className="font-mono">blockchain_notary/.env</span>
        </div>
      </div>
    </div>
  )
}
