import { Card, Chip, EmptyState, Pill, Stat, short, formatTime } from "../components/ui"

export const AUDIT_LABEL: Record<AuditStatus, string> = {
  ON_CHAIN_OK: "Заякорен",
  LOCAL_ONLY: "Локальный",
  MISSING_FILE: "Файл утрачен",
  HASH_MISMATCH: "Подмена",
  ON_CHAIN_MISSING: "Нет в реестре",
}

export const AUDIT_TONE: Record<AuditStatus, "ok" | "warn" | "err" | "mut"> = {
  ON_CHAIN_OK: "ok",
  LOCAL_ONLY: "mut",
  MISSING_FILE: "err",
  HASH_MISMATCH: "err",
  ON_CHAIN_MISSING: "warn",
}

export function RegistryScreen({
  artifacts,
  auditMap,
  queuedCount,
  onOpen,
}: {
  artifacts: ArtifactRecord[]
  auditMap: Map<number, AuditResult>
  queuedCount: number
  onOpen: (a: ArtifactRecord) => void
}) {
  const anchored = artifacts.filter((a) => a.notarized).length
  const versions = artifacts.reduce((sum, a) => sum + a.version, 0)

  return (
    <>
      <div className="grid grid-cols-2 gap-2.5 lg:grid-cols-4">
        <Stat value={artifacts.length} label="документов" />
        <Stat value={anchored} label="заякорено on-chain">
          {anchored > 0 ? <Pill tone="ok">подтверждено</Pill> : null}
        </Stat>
        <Stat value={queuedCount} label="в очереди">
          {queuedCount > 0 ? <Pill tone="warn">ожидают фиксации</Pill> : null}
        </Stat>
        <Stat value={versions} label="версий всего" />
      </div>

      <Card>
        {artifacts.length === 0 ? (
          <EmptyState
            title="Реестр пуст"
            hint="Выберите файл или перетащите его в окно — приложение вычислит SHA-256 и заведёт документ."
          />
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full border-collapse text-[13px]">
              <thead>
                <tr className="border-b border-line text-left text-[11px] font-medium text-faint">
                  <th className="px-3.5 py-2 font-medium">Документ</th>
                  <th className="px-3.5 py-2 font-medium">SHA-256</th>
                  <th className="px-3.5 py-2 font-medium">Версия</th>
                  <th className="px-3.5 py-2 font-medium">Статус</th>
                  <th className="px-3.5 py-2 font-medium">Фиксация</th>
                </tr>
              </thead>
              <tbody>
                {artifacts.map((a) => {
                  const audit = auditMap.get(a.id)
                  const status: AuditStatus =
                    audit?.status ?? (a.notarized ? "ON_CHAIN_OK" : "LOCAL_ONLY")

                  return (
                    <tr
                      key={a.id}
                      onClick={() => onOpen(a)}
                      className="cursor-pointer border-b border-line last:border-0 hover:bg-row-hover"
                    >
                      <td className="px-3.5 py-2.5">
                        <div className="font-medium">{a.display_name}</div>
                        <div className="truncate text-[11.5px] text-muted">{a.file_path}</div>
                      </td>
                      <td className="mono px-3.5 py-2.5 text-faint">{short(a.hash)}</td>
                      <td className="num px-3.5 py-2.5">v{a.version}</td>
                      <td className="px-3.5 py-2.5">
                        <Pill tone={AUDIT_TONE[status]}>{AUDIT_LABEL[status]}</Pill>
                      </td>
                      <td className="px-3.5 py-2.5">
                        {a.notarized ? (
                          <>
                            <div className="num text-[12.5px]">{formatTime(a.created_at)}</div>
                            {a.blockchain_tx ? (
                              <div className="mt-0.5">
                                <Chip>tx {short(a.blockchain_tx, 5)}</Chip>
                              </div>
                            ) : null}
                          </>
                        ) : (
                          <span className="text-[11.5px] text-muted">не фиксировался</span>
                        )}
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        )}
      </Card>
    </>
  )
}
