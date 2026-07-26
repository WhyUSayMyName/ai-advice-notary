import { Button, Card, Chip, EmptyState, Pill, SectionLabel, short, formatTime } from "../components/ui"

const CHAIN_LABEL: Record<VersionChainStatus, string> = {
  OK: "Связь корректна",
  BROKEN_LINK: "Разрыв цепочки",
  MISSING_PREVIOUS_HASH: "Нет ссылки на предыдущую",
  ROOT_VERSION_INVALID: "Некорректная корневая версия",
}

export function DocumentScreen({
  artifact,
  history,
  report,
  liveNotarized,
  record,
  onOpenVersion,
}: {
  artifact: ArtifactRecord | null
  history: ArtifactRecord[]
  report: VersionChainReport | undefined
  /** Результат живой сверки открытого хеша с реестром (кнопка «Проверить») */
  liveNotarized: boolean | null
  record: { author: string; timestamp: number } | null
  onOpenVersion: (a: ArtifactRecord) => void
}) {
  if (!artifact) {
    return (
      <Card>
        <EmptyState
          title="Документ не выбран"
          hint="Откройте любую строку в реестре, чтобы увидеть цепочку версий и данные фиксации."
        />
      </Card>
    )
  }

  const items = new Map(report?.items.map((i) => [i.hash, i]))

  return (
    <>
      <Card className="p-4">
        <div className="flex flex-wrap items-center gap-2">
          {artifact.notarized ? (
            <Pill tone="ok">Заякорен</Pill>
          ) : (
            <Pill tone="mut">Только локально</Pill>
          )}
          {report ? (
            report.ok ? (
              <Chip>цепочка версий цела</Chip>
            ) : (
              <Pill tone="err">цепочка версий нарушена</Pill>
            )
          ) : null}
        </div>

        <dl className="mt-3 grid grid-cols-[130px_1fr] gap-x-3.5 gap-y-1.5 text-[12.5px]">
          <dt className="text-muted">Документ</dt>
          <dd className="break-all">{artifact.display_name}</dd>

          <dt className="text-muted">Файл</dt>
          <dd className="break-all text-muted">{artifact.file_path}</dd>

          <dt className="text-muted">SHA-256 (v{artifact.version})</dt>
          <dd className="mono break-all">{artifact.hash}</dd>

          {artifact.previous_hash ? (
            <>
              <dt className="text-muted">Предыдущая версия</dt>
              <dd className="mono break-all text-muted">{artifact.previous_hash}</dd>
            </>
          ) : null}

          <dt className="text-muted">Транзакция</dt>
          <dd className="mono break-all">{artifact.blockchain_tx ?? "—"}</dd>

          <dt className="text-muted">Заведён</dt>
          <dd className="num">{formatTime(artifact.created_at)}</dd>
        </dl>

        {liveNotarized !== null ? (
          <div className="mt-3 flex flex-wrap items-center gap-2 rounded-[7px] border border-line bg-panel2 px-3 py-2 text-[12px]">
            <span className="text-muted">Сверка с реестром:</span>
            {liveNotarized ? (
              <>
                <Pill tone="ok">хеш найден</Pill>
                {record ? (
                  <span className="mono text-muted">
                    автор {short(record.author, 5)} ·{" "}
                    <span className="num">
                      {record.timestamp ? formatTime(record.timestamp * 1000) : "—"}
                    </span>
                  </span>
                ) : null}
              </>
            ) : (
              <Pill tone="warn">хеша нет в реестре</Pill>
            )}
          </div>
        ) : null}
      </Card>

      <div>
        <SectionLabel>Цепочка версий</SectionLabel>
        <Card className="mt-2">
          {history.length === 0 ? (
            <EmptyState title="Версий пока нет" />
          ) : (
            history.map((v, idx) => {
              const item = items.get(v.hash)
              const broken = item && item.status !== "OK"
              const current = v.hash === artifact.hash

              return (
                <div
                  key={v.id}
                  className="grid grid-cols-[22px_1fr_auto] gap-x-3 border-b border-line px-4 py-3 last:border-0"
                >
                  <div className="flex flex-col items-center">
                    <div
                      className={`mt-1.5 h-2.5 w-2.5 shrink-0 rounded-full border-2 ${
                        broken
                          ? "border-err bg-err"
                          : current
                            ? "border-accent bg-accent"
                            : "border-accent bg-panel"
                      }`}
                    />
                    {idx < history.length - 1 ? (
                      <div className="mt-1 w-px flex-1 bg-line2" />
                    ) : null}
                  </div>

                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-2 font-medium">
                      v{v.version}
                      {current ? <Chip>открыта</Chip> : null}
                      {v.notarized ? <Pill tone="ok">Заякорен</Pill> : <Pill tone="mut">Локально</Pill>}
                      {broken ? <Pill tone="err">{CHAIN_LABEL[item!.status]}</Pill> : null}
                    </div>
                    <div className="mt-1 grid gap-0.5 text-[12px] text-muted">
                      <span className="num">{formatTime(v.created_at)}</span>
                      <span className="mono break-all">
                        hash {short(v.hash)}
                        {v.previous_hash ? ` · prev ${short(v.previous_hash)}` : ""}
                      </span>
                      {broken ? <span className="text-err">{item!.details}</span> : null}
                    </div>
                  </div>

                  <div className="flex items-start">
                    <Button variant="ghost" onClick={() => onOpenVersion(v)}>
                      Открыть
                    </Button>
                  </div>
                </div>
              )
            })
          )}
        </Card>
      </div>
    </>
  )
}
