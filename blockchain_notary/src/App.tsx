import React, { useCallback, useEffect, useMemo, useState } from "react"
import { Sidebar, type ScreenId } from "./components/Sidebar"
import { Screen } from "./components/Screen"
import { Button, Toast, short } from "./components/ui"
import { RegistryScreen } from "./screens/RegistryScreen"
import { DocumentScreen } from "./screens/DocumentScreen"
import { AuditScreen } from "./screens/AuditScreen"
import { QueueScreen } from "./screens/QueueScreen"
import { EpochsScreen } from "./screens/EpochsScreen"
import { EvidenceScreen } from "./screens/EvidenceScreen"

export default function App() {
  const [screen, setScreen] = useState<ScreenId>("registry")
  const [theme, setTheme] = useState<"dark" | "light">("dark")
  const [logsOpen, setLogsOpen] = useState(false)

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
  const [queue, setQueue] = useState<AnchorQueueItem[]>([])
  const [batches, setBatches] = useState<AnchorBatchSummary[]>([])
  const [chainVerdict, setChainVerdict] = useState<ChainVerdict | undefined>()
  const [toast, setToast] = useState<string | null>(null)

  const [selectedArtifact, setSelectedArtifact] = useState<ArtifactRecord | null>(null)
  const [artifactHistory, setArtifactHistory] = useState<ArtifactRecord[]>([])

  const [logs, setLogs] = useState<string[]>([])
  const log = (msg: string) =>
    setLogs((l) => [`[${new Date().toLocaleTimeString("ru-RU")}] ${msg}`, ...l].slice(0, 300))

  useEffect(() => {
    document.documentElement.dataset.theme = theme
  }, [theme])

  // Подтверждение копирования само исчезает — модальность здесь была бы наказанием
  const notify = useCallback((text: string) => {
    setToast(text)
    setTimeout(() => setToast(null), 1800)
  }, [])

  const onHashCopied = useCallback(() => notify("Хеш скопирован"), [notify])

  const auditMap = useMemo(() => new Map(auditResults.map((r) => [r.id, r])), [auditResults])

  const currentReport = useMemo(
    () => chainReports.find((r) => r.artifact_id === selectedArtifact?.artifact_id),
    [chainReports, selectedArtifact]
  )

  const pendingCount = useMemo(
    () => queue.filter((q) => q.status === "pending" || q.status === "sent").length,
    [queue]
  )

  const problemCount = useMemo(
    () =>
      auditResults.filter((r) =>
        ["MISSING_FILE", "HASH_MISMATCH", "ON_CHAIN_MISSING"].includes(r.status)
      ).length,
    [auditResults]
  )

  const loadArtifacts = useCallback(async () => {
    const res = await window.api.listArtifacts()
    if (!res.ok) {
      log(`Ошибка загрузки реестра: ${res.error}`)
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
  }, [])

  const loadQueue = useCallback(async () => {
    const res = await window.api.listAnchorQueue()
    if (!res.ok) {
      log(`Ошибка загрузки очереди: ${res.error}`)
      return
    }
    setQueue(res.queue ?? [])
  }, [])

  const loadBatches = useCallback(async () => {
    const res = await window.api.listAnchorBatches()
    if (!res.ok) {
      log(`Ошибка загрузки эпох: ${res.error}`)
      return
    }
    setBatches(res.batches ?? [])
    setChainVerdict(res.chain)

    if (res.chain && !res.chain.ok) {
      log(`Цепочка эпох нарушена: ${res.chain.reason}`)
    }
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
    void loadQueue()
    void loadBatches()
  }, [loadArtifacts, runAudit, inspectChains, loadQueue, loadBatches])

  // События anchor-очереди: живой статус фиксаций из main-процесса
  useEffect(() => {
    const unsubscribe = window.api.onAnchorUpdated((event) => {
      const h = short(event.item.hash)
      switch (event.type) {
        case "queued":
          log(`Очередь: ${h} поставлен в очередь фиксации`)
          break
        case "sent":
          log(`Очередь: ${h} — транзакция отправлена (${short(event.item.tx_hash ?? "")})`)
          break
        case "confirmed":
          log(`Очередь: ${h} — подтверждено, tx ${short(event.item.tx_hash ?? "")}`)
          setTxHash((cur) => cur || (event.item.tx_hash ?? ""))
          void loadArtifacts()
          void runAudit()
          break
        case "recovered":
          log(`Очередь: ${h} — фиксация подтверждена после перезапуска`)
          void loadArtifacts()
          void runAudit()
          break
        case "retry":
          log(`Очередь: ${h} — попытка ${event.item.attempts} не удалась, повтор позже`)
          break
        case "failed":
          log(`Очередь: ${h} — НЕ выполнено после ${event.item.attempts} попыток`)
          break
      }
      void loadQueue()
      void loadBatches()
    })
    return unsubscribe
  }, [loadArtifacts, runAudit, loadQueue, loadBatches])

  const refreshAll = useCallback(async () => {
    await loadArtifacts()
    await runAudit()
    await inspectChains()
    await loadQueue()
    await loadBatches()
    if (selectedArtifact) await loadArtifactHistory(selectedArtifact.artifact_id)
  }, [
    loadArtifacts,
    runAudit,
    inspectChains,
    loadQueue,
    loadBatches,
    loadArtifactHistory,
    selectedArtifact,
  ])

  const connect = async () => {
    log(`Подключение к ${rpcUrl}`)
    setNetStatus("Подключение…")

    const res = await window.api.connectRpc(rpcUrl)
    if (res.ok) {
      setChainId(res.chainId ?? null)
      setBlockNumber(res.blockNumber ?? null)
      setNetStatus("Подключено")
      log(`Сеть: chainId=${res.chainId}, блок ${res.blockNumber}`)
    } else {
      setNetStatus("Ошибка")
      log(`Ошибка подключения: ${res.error}`)
    }
  }

  const checkHash = async (currentHash: string) => {
    if (!(currentHash.startsWith("0x") && currentHash.length === 66)) return

    const r = await window.api.notaryIsNotarized(currentHash, rpcUrl)
    if (!r.ok) {
      log(`Ошибка проверки: ${r.error}`)
      return
    }

    const isN = Boolean(r.notarized)
    setNotarized(isN)
    log(isN ? `Хеш ${short(currentHash)} найден в реестре` : `Хеш ${short(currentHash)} не заякорен`)

    if (isN) {
      const rr = await window.api.notaryGetRecord(currentHash, rpcUrl)
      if (rr.ok && rr.exists) {
        setRecord({ author: rr.author ?? "", timestamp: rr.timestamp ?? 0 })
      }
    } else {
      setRecord(null)
    }
  }

  const pickFile = async () => {
    setTxHash("")
    const res = await window.api.pickAndHash()
    if (!res.ok) {
      if (res.canceled) log("Выбор файла отменён")
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
    if (!reg.ok) log(`Ошибка локального сохранения: ${reg.error}`)
    else log("Файл сохранён в локальном реестре")

    await refreshAll()
    await checkHash(nextHash)
  }

  const handleDrop = async (ev: React.DragEvent<HTMLDivElement>) => {
    ev.preventDefault()
    const f = ev.dataTransfer.files?.[0]
    if (!f) return

    type ElectronFile = File & { path?: string }
    const dropped = (f as ElectronFile).path
    if (!dropped) {
      log("Не удалось получить путь файла")
      return
    }

    const res = await window.api.hashPath(dropped)
    if (!res.ok) {
      log(`Ошибка хеширования: ${res.error}`)
      return
    }

    const nextFilePath = res.filePath ?? dropped
    const nextHash = res.hashHex ?? ""

    setFilePath(nextFilePath)
    setHashHex(nextHash)
    setNotarized(null)
    setRecord(null)
    setTxHash("")

    log(`Файл: ${nextFilePath}`)
    log(`SHA-256: ${nextHash}`)

    const reg = await window.api.registerArtifact(nextFilePath, selectedArtifact?.display_name)
    if (!reg.ok) log(`Ошибка локального сохранения: ${reg.error}`)

    await refreshAll()
    await checkHash(nextHash)
  }

  const notarizeNow = async () => {
    if (!filePath) {
      log("Сначала выберите файл")
      return
    }

    log(`Нотаризация: ${filePath}`)
    const r = await window.api.notarizeArtifact(filePath, selectedArtifact?.display_name)
    if (!r.ok) {
      log(`Ошибка нотаризации: ${r.error}`)
      return
    }

    if (r.hash) setHashHex(r.hash)
    setTxHash(r.txHash ?? "")

    if (r.alreadyNotarized) {
      log("Файл уже был зафиксирован ранее")
      await checkHash(r.hash ?? hashHex)
    } else if (r.queued) {
      log("Фиксация поставлена в очередь — подтверждение придёт автоматически")
    }

    await refreshAll()
  }

  const createVersionFromCurrentFile = async () => {
    if (!selectedArtifact) {
      log("Сначала откройте документ в реестре")
      return
    }
    if (!filePath) {
      log("Сначала выберите файл новой версии")
      return
    }

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
    log(
      res.unchanged
        ? "Файл не изменился с последней версии — новая версия не создавалась"
        : `Новая версия сохранена: ${short(res.hash ?? "")}`
    )

    await refreshAll()
    await checkHash(res.hash ?? hashHex)
  }

  const notarizeSelectedVersion = async () => {
    if (!selectedArtifact) {
      log("Сначала откройте документ в реестре")
      return
    }
    if (!filePath) {
      log("Сначала выберите файл новой версии")
      return
    }

    const r = await window.api.notarizeArtifactVersion(
      selectedArtifact.artifact_id,
      filePath,
      selectedArtifact.display_name
    )
    if (!r.ok) {
      log(`Ошибка нотаризации версии: ${r.error}`)
      return
    }

    if (r.hash) setHashHex(r.hash)
    setTxHash(r.txHash ?? "")

    if (r.unchanged) log("Файл не изменился с последней версии — новая версия не создавалась")
    if (r.alreadyNotarized) {
      log("Эта версия уже была зафиксирована")
      await checkHash(r.hash ?? hashHex)
    } else if (r.queued) {
      log("Фиксация версии поставлена в очередь")
    }

    await refreshAll()
  }

  const savePdf = async () => {
    if (!filePath || !hashHex || !record || !txHash) {
      log("Для сертификата нужны: файл, хеш, подтверждённая запись в реестре и транзакция")
      return
    }

    const res = await window.api.saveCertificatePdf({
      filePath,
      hashHex,
      rpcUrl,
      author: record.author,
      timestamp: record.timestamp,
      txHash,
    })

    if (res.ok) log(`Сертификат сохранён: ${res.filePath}`)
    else if (res.canceled) log("Сохранение отменено")
    else log(`Ошибка сертификата: ${res.error}`)
  }

  const exportEvidence = async () => {
    log("Экспорт пакета доказательств…")
    const res = await window.api.exportEvidence(rpcUrl)

    if (res.ok) {
      log(`Пакет сохранён: ${res.filePath} (записей: ${res.artifacts})`)
      log("Передайте аудитору: этот файл + документы + verifier-cli из репозитория")
    } else if (res.canceled) {
      log("Экспорт отменён")
    } else {
      log(`Ошибка экспорта: ${res.error}`)
    }
  }

  const openArtifact = async (artifact: ArtifactRecord) => {
    setSelectedArtifact(artifact)
    setFilePath(artifact.file_path)
    setHashHex(artifact.hash)
    setTxHash(artifact.blockchain_tx ?? "")
    setNotarized(Boolean(artifact.notarized))
    setRecord(null)
    setScreen("document")

    log(`Открыт документ: ${artifact.display_name} v${artifact.version}`)

    await loadArtifactHistory(artifact.artifact_id)
    await checkHash(artifact.hash)
  }

  const openVersion = async (artifact: ArtifactRecord) => {
    setFilePath(artifact.file_path)
    setHashHex(artifact.hash)
    setTxHash(artifact.blockchain_tx ?? "")
    setNotarized(Boolean(artifact.notarized))
    setRecord(null)

    log(`Открыта версия v${artifact.version}`)
    await checkHash(artifact.hash)
  }

  const screens: Record<ScreenId, React.ReactNode> = {
    registry: (
      <Screen
        title="Реестр документов"
        subtitle={filePath ? `Выбран: ${filePath}` : "Перетащите файл в окно или выберите вручную"}
        actions={
          <>
            <Button onClick={refreshAll}>Обновить</Button>
            <Button onClick={notarizeNow} disabled={!filePath}>
              Зафиксировать
            </Button>
            <Button variant="primary" onClick={pickFile}>
              Выбрать файл
            </Button>
          </>
        }
      >
        <RegistryScreen
          artifacts={artifacts}
          auditMap={auditMap}
          queuedCount={pendingCount}
          onOpen={openArtifact}
          onCopied={onHashCopied}
        />
      </Screen>
    ),

    document: (
      <Screen
        breadcrumb={
          <button className="text-accent-hi hover:underline" onClick={() => setScreen("registry")}>
            Реестр
          </button>
        }
        title={selectedArtifact?.display_name ?? "Документ"}
        actions={
          <>
            <Button onClick={() => checkHash(hashHex)} disabled={!hashHex}>
              Проверить
            </Button>
            <Button onClick={savePdf} disabled={!record || !txHash}>
              Сертификат
            </Button>
            <Button onClick={createVersionFromCurrentFile} disabled={!selectedArtifact}>
              Новая версия
            </Button>
            <Button variant="primary" onClick={notarizeSelectedVersion} disabled={!selectedArtifact}>
              Зафиксировать версию
            </Button>
          </>
        }
      >
        <DocumentScreen
          artifact={selectedArtifact}
          history={artifactHistory}
          report={currentReport}
          liveNotarized={notarized}
          record={record}
          onOpenVersion={openVersion}
        />
      </Screen>
    ),

    audit: (
      <Screen
        title="Аудит целостности"
        subtitle="Файлы ↔ локальный реестр ↔ внешний реестр"
        actions={
          <>
            <Button variant="primary" onClick={runAudit}>
              Запустить аудит
            </Button>
          </>
        }
      >
        <AuditScreen
          results={auditResults}
          onCopied={onHashCopied}
          onOpenQueue={() => setScreen("queue")}
        />
      </Screen>
    ),

    queue: (
      <Screen
        title="Очередь якорения"
        subtitle="Фиксации переживают сбои: очередь хранится локально и дожимается воркером"
        actions={
          <>
            <Button onClick={loadQueue}>Обновить</Button>
          </>
        }
      >
        <QueueScreen queue={queue} />
      </Screen>
    ),

    epochs: (
      <Screen
        title="Кольца эпох"
        subtitle="Ствол реестра: каждая эпоха — пакет документов, закрытый одной транзакцией"
        actions={<Button onClick={loadBatches}>Обновить</Button>}
      >
        <EpochsScreen batches={batches} chain={chainVerdict} onCopied={onHashCopied} />
      </Screen>
    ),

    evidence: (
      <Screen
        title="Пакет доказательств"
        subtitle="Аудитор проверяет всё сам — без доверия к этому приложению"
        actions={
          <>
            <Button variant="primary" onClick={exportEvidence}>
              Экспортировать
            </Button>
          </>
        }
      >
        <EvidenceScreen
          artifacts={artifacts.length}
          anchored={artifacts.filter((a) => a.notarized).length}
          chainId={chainId}
        />
      </Screen>
    ),
  }

  return (
    <div
      className="flex h-full w-full overflow-hidden bg-bg text-ink"
      onDragOver={(e) => e.preventDefault()}
      onDrop={handleDrop}
    >
      <Sidebar
        screen={screen}
        onScreen={setScreen}
        counts={{
          registry: artifacts.length,
          queue: pendingCount,
          audit: problemCount,
          epochs: batches.length,
        }}
        alerts={{ audit: problemCount > 0 }}
        connected={netStatus === "Подключено"}
        netStatus={netStatus}
        chainId={chainId}
        blockNumber={blockNumber}
        rpcUrl={rpcUrl}
        onRpcUrl={setRpcUrl}
        onConnect={connect}
        documentEnabled={Boolean(selectedArtifact)}
        theme={theme}
        onToggleTheme={() => setTheme((t) => (t === "dark" ? "light" : "dark"))}
      />

      <div className="flex min-w-0 flex-1 flex-col">
        {screens[screen]}

        <div className="shrink-0 border-t border-line bg-panel">
          <button
            onClick={() => setLogsOpen((v) => !v)}
            className="flex w-full items-center gap-2 px-5 py-1.5 text-[11.5px] text-muted hover:text-ink"
          >
            <span className="font-semibold uppercase tracking-[0.08em]">Журнал</span>
            {logs.length > 0 ? <span className="num text-faint">{logs.length}</span> : null}
            <span className="mono ml-2 min-w-0 flex-1 truncate text-left text-faint">
              {!logsOpen && logs[0] ? logs[0] : ""}
            </span>
            <span className="text-faint">{logsOpen ? "▾" : "▴"}</span>
          </button>

          {logsOpen ? (
            <div className="mono max-h-[190px] overflow-auto border-t border-line px-5 py-2 text-[11.5px] leading-[1.8]">
              {logs.length === 0 ? (
                <div className="text-faint">Пока пусто</div>
              ) : (
                logs.map((l, i) => (
                  <div key={i} className="text-muted">
                    {l}
                  </div>
                ))
              )}
            </div>
          ) : null}
        </div>
      </div>

      <Toast text={toast} />
    </div>
  )
}
