import React, { useCallback, useEffect, useMemo, useState } from "react"

type ArtifactRecord = {
  id: number
  artifact_id: string
  display_name: string
  file_path: string
  hash: string
  version: number
  previous_hash: string | null
  created_at: number
  blockchain_tx: string | null
  notarized: number
}

type AuditStatus =
  | "LOCAL_ONLY"
  | "ON_CHAIN_OK"
  | "MISSING_FILE"
  | "HASH_MISMATCH"
  | "ON_CHAIN_MISSING"

type AuditResult = {
  id: number
  artifact_id: string
  file_path: string
  stored_hash: string
  current_hash: string | null
  blockchain_tx: string | null
  notarized: number
  created_at: number
  status: AuditStatus
  author?: string
  timestamp?: number
}

type VersionChainStatus =
  | "OK"
  | "BROKEN_LINK"
  | "MISSING_PREVIOUS_HASH"
  | "ROOT_VERSION_INVALID"

type VersionChainItem = {
  id: number
  artifact_id: string
  display_name: string
  version: number
  hash: string
  previous_hash: string | null
  status: VersionChainStatus
  details: string
}

type VersionChainReport = {
  artifact_id: string
  display_name: string
  ok: boolean
  items: VersionChainItem[]
}

function short(s: string, n = 10) {
  if (!s) return s
  if (s.length <= n * 2 + 3) return s
  return `${s.slice(0, n)}…${s.slice(-n)}`
}

function renderAuditStatus(status?: AuditStatus) {
  switch (status) {
    case "ON_CHAIN_OK":
      return <span className="font-medium text-green-700">On-chain OK</span>
    case "LOCAL_ONLY":
      return <span className="font-medium text-amber-700">Local only</span>
    case "MISSING_FILE":
      return <span className="font-medium text-red-700">Missing file</span>
    case "HASH_MISMATCH":
      return <span className="font-medium text-red-700">Hash mismatch</span>
    case "ON_CHAIN_MISSING":
      return <span className="font-medium text-orange-700">On-chain missing</span>
    default:
      return <span className="text-zinc-500">—</span>
  }
}

export default function App() {
  const [rpcUrl, setRpcUrl] = useState("http://127.0.0.1:8545")
  const [netStatus, setNetStatus] = useState("Отключено")
  const [chainId, setChainId] = useState<number | null>(null)
  const [blockNumber, setBlockNumber] = useState<number | null>(null)

  const [filePath, setFilePath] = useState("")
  const [hashHex, setHashHex] = useState("")
  const [txHash, setTxHash] = useState("")
  const [notarized, setNotarized] = useState<boolean | null>(null)
  const [record, setRecord] = useState<{ author: string; timestamp: number } | null>(null)

  const [artifacts, setArtifacts] = useState<ArtifactRecord[]>([])
  const [auditResults, setAuditResults] = useState<AuditResult[]>([])
  const [chainReports, setChainReports] = useState<VersionChainReport[]>([])

  const [selectedArtifact, setSelectedArtifact] = useState<ArtifactRecord | null>(null)
  const [artifactHistory, setArtifactHistory] = useState<ArtifactRecord[]>([])

  const [logs, setLogs] = useState<string[]>([])
  const log = (msg: string) =>
    setLogs((l) => [`[${new Date().toLocaleTimeString()}] ${msg}`, ...l])

  const canCheck = hashHex.startsWith("0x") && hashHex.length === 66

  const tsHuman = useMemo(() => {
    if (!record?.timestamp) return null
    return new Date(record.timestamp * 1000).toLocaleString()
  }, [record])

  const auditMap = useMemo(() => {
    return new Map(auditResults.map((r) => [r.id, r]))
  }, [auditResults])

  const loadArtifacts = useCallback(async () => {
    const res = await window.api.listArtifacts()
    if (!res.ok) {
      log(`Ошибка загрузки истории: ${res.error}`)
      return
    }
    setArtifacts(res.artifacts ?? [])
  }, [])

  const runAudit = useCallback(async () => {
    const res = await window.api.auditArtifacts()
    if (!res.ok) {
      log(`Ошибка аудита: ${res.error}`)
      return
    }
    setAuditResults(res.results ?? [])
    log(`Аудит завершён, записей: ${res.results?.length ?? 0}`)
  }, [])

  const inspectChains = useCallback(async () => {
    const res = await window.api.inspectVersionChains()
    if (!res.ok) {
      log(`Ошибка проверки цепочек: ${res.error}`)
      return
    }
    setChainReports(res.reports ?? [])
    log(`Проверка цепочек завершена, документов: ${res.reports?.length ?? 0}`)
  }, [])

  const loadArtifactHistory = useCallback(async (artifactId: string) => {
    const res = await window.api.getArtifactHistory(artifactId)
    if (!res.ok) {
      log(`Ошибка загрузки версий: ${res.error}`)
      return
    }
    setArtifactHistory(res.history ?? [])
  }, [])

  useEffect(() => {
    void loadArtifacts()
    void runAudit()
    void inspectChains()
  }, [loadArtifacts, runAudit, inspectChains])

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

  const checkHash = async (currentHash: string) => {
    if (!(currentHash.startsWith("0x") && currentHash.length === 66)) return

    log(`Проверка в контракте: ${currentHash}`)
    const r = await window.api.notaryIsNotarized(currentHash, rpcUrl)
    if (!r.ok) {
      log(`Ошибка: ${r.error}`)
      return
    }

    const isN = Boolean(r.notarized)
    setNotarized(isN)
    log(isN ? "Уже нотариально записан ✅" : "Ещё не записан ❌")

    if (isN) {
      const rr = await window.api.notaryGetRecord(currentHash, rpcUrl)
      if (rr.ok && rr.exists) {
        setRecord({ author: rr.author ?? "", timestamp: rr.timestamp ?? 0 })
        log(`Record: author=${rr.author}, ts=${rr.timestamp}`)
      }
    } else {
      setRecord(null)
    }
  }

  const check = async () => {
    if (!canCheck) return
    await checkHash(hashHex)
  }

  const refreshAll = async () => {
    await loadArtifacts()
    await runAudit()
    await inspectChains()
    if (selectedArtifact) {
      await loadArtifactHistory(selectedArtifact.artifact_id)
    }
  }

  const notarizeNow = async () => {
    if (!filePath) {
      log("Сначала выбери файл")
      return
    }

    log(`Нотариат: регистрация и отправка TX для ${filePath}`)
    const r = await window.api.notarizeArtifact(filePath, selectedArtifact?.display_name)

    if (!r.ok) {
      log(`Ошибка TX: ${r.error}`)
      return
    }

    if (r.hash) setHashHex(r.hash)
    setTxHash(r.txHash ?? "")

    if (r.alreadyNotarized) {
      log("Файл уже был нотариально записан ранее")
    } else {
      log(`TX OK: ${r.txHash} (block ${r.blockNumber})`)
    }

    await checkHash(r.hash ?? hashHex)
    await refreshAll()
  }

  const notarizeSelectedVersion = async () => {
    if (!selectedArtifact) {
      log("Сначала выбери документ из истории")
      return
    }
    if (!filePath) {
      log("Сначала выбери файл новой версии")
      return
    }

    log(`Нотариат новой версии для ${selectedArtifact.display_name}`)
    const r = await window.api.notarizeArtifactVersion(
      selectedArtifact.artifact_id,
      filePath,
      selectedArtifact.display_name
    )

    if (!r.ok) {
      log(`Ошибка TX версии: ${r.error}`)
      return
    }

    if (r.hash) setHashHex(r.hash)
    setTxHash(r.txHash ?? "")

    if (r.unchanged) {
      log("Файл не изменился с последней версии — новая версия не создавалась")
    }
    if (r.alreadyNotarized) {
      log("Эта версия уже была нотариально записана")
    } else {
      log(`TX OK: ${r.txHash} (block ${r.blockNumber})`)
    }

    await checkHash(r.hash ?? hashHex)
    await refreshAll()
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
    setTxHash("")

    const res = await window.api.pickAndHash()
    if (!res.ok) {
      if (res.canceled) log("Отменено пользователем")
      else log(`Ошибка выбора файла: ${res.error}`)
      return
    }

    const nextFilePath = res.filePath ?? ""
    const nextHash = res.hashHex ?? ""

    setFilePath(nextFilePath)
    setHashHex(nextHash)
    setNotarized(null)
    setRecord(null)

    log(`Файл: ${nextFilePath}`)
    log(`SHA-256: ${nextHash}`)

    const reg = await window.api.registerArtifact(nextFilePath, selectedArtifact?.display_name)
    if (!reg.ok) {
      log(`Ошибка локального сохранения: ${reg.error}`)
    } else {
      log("Файл сохранён в локальном реестре")
    }

    await refreshAll()
    await checkHash(nextHash)
  }

  const createVersionFromCurrentFile = async () => {
    if (!selectedArtifact) {
      log("Сначала выбери документ в истории")
      return
    }
    if (!filePath) {
      log("Сначала выбери файл")
      return
    }

    log(`Создание новой версии для ${selectedArtifact.display_name}`)
    const res = await window.api.createArtifactVersion(
      selectedArtifact.artifact_id,
      filePath,
      selectedArtifact.display_name
    )

    if (!res.ok) {
      log(`Ошибка создания версии: ${res.error}`)
      return
    }

    if (res.hash) setHashHex(res.hash)
    if (res.unchanged) {
      log("Файл не изменился с последней версии — новая версия не создавалась")
    } else {
      log(`Новая версия сохранена: ${res.hash}`)
    }
    await refreshAll()
    await checkHash(res.hash ?? hashHex)
  }

  const handleDragOver = (ev: React.DragEvent<HTMLDivElement>) => {
    ev.preventDefault()
  }

  const handleDrop = async (ev: React.DragEvent<HTMLDivElement>) => {
    ev.preventDefault()
    const f = ev.dataTransfer.files?.[0]
    if (!f) return

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

    const nextFilePath = res.filePath ?? filePathDropped
    const nextHash = res.hashHex ?? ""

    setFilePath(nextFilePath)
    setHashHex(nextHash)
    setNotarized(null)
    setRecord(null)
    setTxHash("")

    log(`SHA-256: ${nextHash}`)

    const reg = await window.api.registerArtifact(nextFilePath, selectedArtifact?.display_name)
    if (!reg.ok) {
      log(`Ошибка локального сохранения: ${reg.error}`)
    } else {
      log("Файл сохранён в локальном реестре")
    }

    await refreshAll()
    await checkHash(nextHash)
  }

  const openArtifactFromHistory = async (artifact: ArtifactRecord) => {
    setSelectedArtifact(artifact)
    setFilePath(artifact.file_path)
    setHashHex(artifact.hash)
    setTxHash(artifact.blockchain_tx ?? "")
    setNotarized(Boolean(artifact.notarized))
    setRecord(null)

    log(`Выбран документ: ${artifact.display_name} v${artifact.version}`)

    await loadArtifactHistory(artifact.artifact_id)
    await checkHash(artifact.hash)
  }

  const openVersion = async (artifact: ArtifactRecord) => {
    setFilePath(artifact.file_path)
    setHashHex(artifact.hash)
    setTxHash(artifact.blockchain_tx ?? "")
    setNotarized(Boolean(artifact.notarized))
    setRecord(null)

    log(`Выбрана версия v${artifact.version}: ${artifact.file_path}`)
    await checkHash(artifact.hash)
  }

  return (
    <div className="min-h-screen bg-zinc-50 p-6">
      <div className="mx-auto max-w-7xl space-y-6">
        <header className="flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-semibold text-zinc-900">Blockchain Notary</h1>
            <p className="text-sm text-zinc-600">
              Файл → SHA-256 → Локальный реестр → Версии → Смарт-контракт
            </p>
          </div>
          <div className="text-xs text-zinc-500">Hardhat chainId 31337</div>
        </header>

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

        <div className="rounded-2xl border border-zinc-200 bg-white p-5 shadow-sm">
          <div className="flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
            <div>
              <div className="text-sm font-medium text-zinc-900">Нотариат</div>
              <div className="text-sm text-zinc-600">Выбери файл или перетащи его сюда</div>
            </div>

            <div className="flex flex-wrap gap-3">
              <button
                onClick={pickFile}
                className="rounded-xl bg-black px-4 py-2 text-sm font-medium text-white"
              >
                Выбрать файл
              </button>

              <button
                onClick={check}
                disabled={!canCheck}
                className="rounded-xl border px-4 py-2 text-sm disabled:opacity-40"
              >
                Check
              </button>

              <button
                onClick={notarizeNow}
                disabled={!filePath}
                className="rounded-xl bg-emerald-600 px-4 py-2 text-sm font-medium text-white disabled:opacity-40"
              >
                Notarize
              </button>

              <button
                onClick={createVersionFromCurrentFile}
                disabled={!selectedArtifact || !filePath}
                className="rounded-xl border px-4 py-2 text-sm disabled:opacity-40"
              >
                New Version from File
              </button>

              <button
                onClick={notarizeSelectedVersion}
                disabled={!selectedArtifact || !filePath}
                className="rounded-xl bg-blue-600 px-4 py-2 text-sm font-medium text-white disabled:opacity-40"
              >
                Notarize Version
              </button>

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

              {selectedArtifact && (
                <div className="mt-3 text-xs text-zinc-700">
                  <div>Документ: {selectedArtifact.display_name}</div>
                  <div>
                    Artifact ID:{" "}
                    <span className="font-mono">{short(selectedArtifact.artifact_id, 12)}</span>
                  </div>
                  <div>Текущая версия: v{selectedArtifact.version}</div>
                </div>
              )}
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

              {txHash && (
                <div className="mt-2 text-xs text-zinc-700">
                  TX: <span className="font-mono">{short(txHash, 14)}</span>
                </div>
              )}
            </div>
          </div>
        </div>

        <div className="grid grid-cols-1 gap-6 xl:grid-cols-3">
          <div className="xl:col-span-2 rounded-2xl border border-zinc-200 bg-white p-5 shadow-sm">
            <div className="flex items-center justify-between">
              <div>
                <div className="text-sm font-medium text-zinc-900">История документов</div>
                <div className="text-sm text-zinc-600">Показываются последние версии</div>
              </div>
              <div className="flex gap-3">
                <button
                  onClick={loadArtifacts}
                  className="rounded-xl border px-4 py-2 text-sm"
                >
                  Обновить
                </button>
                <button
                  onClick={runAudit}
                  className="rounded-xl border px-4 py-2 text-sm"
                >
                  Audit
                </button>
                <button
                  onClick={inspectChains}
                  className="rounded-xl border px-4 py-2 text-sm"
                >
                  Check Chains
                </button>
              </div>
            </div>

            <div className="mt-4 overflow-auto rounded-xl border border-zinc-200">
              {artifacts.length === 0 ? (
                <div className="p-4 text-sm text-zinc-500">Пока нет сохранённых документов</div>
              ) : (
                <table className="min-w-full text-sm">
                  <thead className="bg-zinc-50 text-left text-zinc-600">
                    <tr>
                      <th className="px-4 py-3">Документ</th>
                      <th className="px-4 py-3">Версия</th>
                      <th className="px-4 py-3">Хеш</th>
                      <th className="px-4 py-3">Статус</th>
                      <th className="px-4 py-3">TX</th>
                      <th className="px-4 py-3">Создан</th>
                    </tr>
                  </thead>
                  <tbody>
                    {artifacts.map((a) => {
                      const ar = auditMap.get(a.id)

                      return (
                        <tr
                          key={a.id}
                          className="cursor-pointer border-t border-zinc-200 hover:bg-zinc-50"
                          onClick={() => void openArtifactFromHistory(a)}
                        >
                          <td className="px-4 py-3 text-zinc-900">{a.display_name}</td>
                          <td className="px-4 py-3 text-zinc-700">v{a.version}</td>
                          <td className="px-4 py-3 font-mono text-zinc-700">{short(a.hash, 12)}</td>
                          <td className="px-4 py-3">{renderAuditStatus(ar?.status)}</td>
                          <td className="px-4 py-3 font-mono text-zinc-700">
                            {a.blockchain_tx ? short(a.blockchain_tx, 10) : "—"}
                          </td>
                          <td className="px-4 py-3 text-zinc-700">
                            {new Date(a.created_at).toLocaleString()}
                          </td>
                        </tr>
                      )
                    })}
                  </tbody>
                </table>
              )}
            </div>

            {auditResults.length > 0 && (
              <div className="mt-4 rounded-xl bg-zinc-50 p-4 text-sm text-zinc-700">
                <div className="font-medium text-zinc-900">Сводка аудита</div>
                <div className="mt-2 grid grid-cols-1 gap-2 md:grid-cols-2">
                  <div>ON_CHAIN_OK: {auditResults.filter((r) => r.status === "ON_CHAIN_OK").length}</div>
                  <div>LOCAL_ONLY: {auditResults.filter((r) => r.status === "LOCAL_ONLY").length}</div>
                  <div>MISSING_FILE: {auditResults.filter((r) => r.status === "MISSING_FILE").length}</div>
                  <div>HASH_MISMATCH: {auditResults.filter((r) => r.status === "HASH_MISMATCH").length}</div>
                  <div>ON_CHAIN_MISSING: {auditResults.filter((r) => r.status === "ON_CHAIN_MISSING").length}</div>
                </div>
              </div>
            )}

            {chainReports.length > 0 && (
              <div className="mt-4 rounded-xl bg-zinc-50 p-4 text-sm text-zinc-700">
                <div className="font-medium text-zinc-900">Проверка цепочек версий</div>
                <div className="mt-2 space-y-2">
                  {chainReports.map((report) => (
                    <div
                      key={report.artifact_id}
                      className="rounded-lg border border-zinc-200 bg-white p-3"
                    >
                      <div className="flex items-center justify-between">
                        <div className="font-medium text-zinc-900">{report.display_name}</div>
                        <div>
                          {report.ok ? (
                            <span className="font-medium text-green-700">Chain OK</span>
                          ) : (
                            <span className="font-medium text-red-700">Chain Broken</span>
                          )}
                        </div>
                      </div>

                      <div className="mt-2 space-y-1 text-xs text-zinc-700">
                        {report.items.map((item) => (
                          <div key={item.id} className="flex items-center justify-between gap-4">
                            <div>
                              v{item.version} — <span className="font-mono">{short(item.hash, 10)}</span>
                            </div>
                            <div className={item.status === "OK" ? "text-green-700" : "text-red-700"}>
                              {item.status}: {item.details}
                            </div>
                          </div>
                        ))}
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>

          <div className="rounded-2xl border border-zinc-200 bg-white p-5 shadow-sm">
            <div className="text-sm font-medium text-zinc-900">История версий</div>
            <div className="text-sm text-zinc-600">
              {selectedArtifact ? selectedArtifact.display_name : "Выбери документ из списка"}
            </div>

            <div className="mt-4 space-y-3">
              {artifactHistory.length === 0 ? (
                <div className="rounded-xl bg-zinc-50 p-4 text-sm text-zinc-500">
                  Нет данных о версиях
                </div>
              ) : (
                artifactHistory.map((v) => (
                  <button
                    key={v.id}
                    onClick={() => void openVersion(v)}
                    className="w-full rounded-xl border border-zinc-200 bg-zinc-50 p-3 text-left hover:bg-zinc-100"
                  >
                    <div className="flex items-center justify-between">
                      <div className="font-medium text-zinc-900">v{v.version}</div>
                      <div className="text-xs text-zinc-500">
                        {v.notarized ? "notarized" : "local"}
                      </div>
                    </div>
                    <div className="mt-1 text-xs text-zinc-700">{v.file_path}</div>
                    <div className="mt-1 font-mono text-xs text-zinc-600">{short(v.hash, 14)}</div>
                    {v.previous_hash && (
                      <div className="mt-1 text-xs text-zinc-500">
                        prev: <span className="font-mono">{short(v.previous_hash, 10)}</span>
                      </div>
                    )}
                  </button>
                ))
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