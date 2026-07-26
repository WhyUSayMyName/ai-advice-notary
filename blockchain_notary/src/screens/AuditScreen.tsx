import { Card, EmptyState, Pill, short } from "../components/ui"
import { AUDIT_LABEL, AUDIT_TONE } from "./RegistryScreen"

const EXPLAIN: Record<AuditStatus, string> = {
  ON_CHAIN_OK: "Файл, локальный реестр и внешний реестр согласованы",
  LOCAL_ONLY: "Есть только в локальном реестре — фиксация не выполнялась",
  MISSING_FILE: "Файл отсутствует, но запись о фиксации существует — возможное уничтожение",
  HASH_MISMATCH: "Хеш файла не совпадает с заякоренным значением — содержимое изменено",
  ON_CHAIN_MISSING: "Запись помечена как заякоренная, но в реестре её нет",
}

const PROBLEM: AuditStatus[] = ["MISSING_FILE", "HASH_MISMATCH", "ON_CHAIN_MISSING"]

export function AuditScreen({ results }: { results: AuditResult[] }) {
  if (results.length === 0) {
    return (
      <Card>
        <EmptyState
          title="Аудит ещё не запускался"
          hint="Проверка сверяет файлы на диске, локальный реестр и записи во внешнем реестре."
        />
      </Card>
    )
  }

  const counts = results.reduce<Record<string, number>>((acc, r) => {
    acc[r.status] = (acc[r.status] ?? 0) + 1
    return acc
  }, {})

  // Проблемы поднимаются наверх — иначе их приходится искать глазами
  const sorted = [...results].sort(
    (a, b) => Number(PROBLEM.includes(b.status)) - Number(PROBLEM.includes(a.status))
  )

  return (
    <>
      <div className="flex flex-wrap items-center gap-2">
        {(Object.keys(counts) as AuditStatus[]).map((status) => (
          <Pill key={status} tone={AUDIT_TONE[status]}>
            {counts[status]} · {AUDIT_LABEL[status]}
          </Pill>
        ))}
        <span className="text-[11.5px] text-muted">всего записей: {results.length}</span>
      </div>

      <Card>
        {sorted.map((r) => {
          const bad = PROBLEM.includes(r.status)

          return (
            <div
              key={r.id}
              className={`grid grid-cols-[3px_1fr_auto] gap-x-3.5 border-b border-line py-3 pr-3.5 last:border-0 ${
                bad ? "" : "opacity-95"
              }`}
            >
              <div className={`rounded-sm ${bad ? "bg-err" : "bg-transparent"}`} />

              <div className="min-w-0">
                <div className="truncate font-medium">{r.file_path}</div>
                <div className={`mt-0.5 text-[12px] ${bad ? "text-err" : "text-muted"}`}>
                  {EXPLAIN[r.status]}
                </div>
                <div className="mono mt-0.5 text-[11.5px] text-faint">
                  {r.status === "HASH_MISMATCH" ? (
                    <>
                      ожидался {short(r.stored_hash)} · фактический{" "}
                      {r.current_hash ? short(r.current_hash) : "—"}
                    </>
                  ) : (
                    <>заякорен {short(r.stored_hash)}</>
                  )}
                </div>
              </div>

              <div className="flex items-start">
                <Pill tone={AUDIT_TONE[r.status]}>{AUDIT_LABEL[r.status]}</Pill>
              </div>
            </div>
          )
        })}
      </Card>
    </>
  )
}
