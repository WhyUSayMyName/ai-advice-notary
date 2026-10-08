import { Card, EmptyState, Hash, Pill, Tree } from "../components/ui"
import { AUDIT_LABEL, AUDIT_TONE } from "./audit-status"

const EXPLAIN: Record<AuditStatus, string> = {
  ON_CHAIN_OK: "Файл, локальный реестр и внешний реестр согласованы",
  LOCAL_ONLY: "Есть только в локальном реестре — фиксация не выполнялась",
  MISSING_FILE: "Файл отсутствует, но запись о фиксации существует — возможное уничтожение",
  HASH_MISMATCH: "Хеш файла не совпадает с заякоренным значением — содержимое изменено",
  ON_CHAIN_MISSING: "Документ заякорен в этом реестре, но записи там нет",
  OTHER_REGISTRY:
    "Документ заякорен в другой сети или другом контракте — здесь он не проверяется. Подключитесь к той сети, чтобы проверить",
  REGISTRY_UNKNOWN:
    "Документ заякорен до того, как приложение стало записывать сеть фиксации, и в этом реестре его нет. Это не признак подмены: проверьте в сети, где он фиксировался",
}

/** Что делать с находкой: диагноз без следующего шага бесполезен инспектору */
const REMEDY: Partial<Record<AuditStatus, string[]>> = {
  HASH_MISMATCH: [
    "Восстановить файл из резервной копии — заякоренный хеш останется верным",
    "Либо оформить текущее содержимое новой версией: старая останется в цепочке",
  ],
  MISSING_FILE: [
    "Найти файл в резервной копии и вернуть по прежнему пути",
    "Если файл утрачен безвозвратно — зафиксировать это актом: запись о фиксации сама по себе доказательство, что документ существовал",
  ],
  ON_CHAIN_MISSING: [
    "Проверить, что узел не был перезапущен с чистого листа (локальная сеть так теряет историю)",
    "Если сеть верна — отправить фиксацию заново из очереди",
  ],
}

const PROBLEM: AuditStatus[] = ["MISSING_FILE", "HASH_MISMATCH", "ON_CHAIN_MISSING"]

export function AuditScreen({
  results,
  onCopied,
  onOpenQueue,
}: {
  results: AuditResult[]
  onCopied: (v: string) => void
  onOpenQueue: () => void
}) {
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

  const problems = results.filter((r) => PROBLEM.includes(r.status))

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
      {problems.length > 0 ? (
        <div className="rounded-[var(--radius)] border border-err bg-err-bg px-4 py-3.5">
          <div className="flex flex-wrap items-baseline gap-x-2.5 gap-y-1">
            <span className="num text-[17px] font-semibold text-err">
              {problems.length}{" "}
              {problems.length === 1 ? "расхождение" : problems.length < 5 ? "расхождения" : "расхождений"}
            </span>
            <span className="text-[13px] text-muted">из {results.length} записей</span>
          </div>
          <p className="mt-1 max-w-[74ch] text-[12.5px] text-ink">
            {problems.some((p) => p.status === "HASH_MISMATCH")
              ? "Содержимое документа изменилось после фиксации. Внешний реестр хранит прежний хеш — подмена доказуема."
              : "Есть записи о фиксации без файлов на диске. Это тот случай, ради которого система и строилась."}
          </p>
        </div>
      ) : (
        // Состояние «всё сходится» пользователь видит чаще всего —
        // оно должно выглядеть результатом работы, а не пустой таблицей
        <div className="flex items-center gap-3.5 rounded-[var(--radius)] border border-line bg-ok-bg px-4 py-3.5">
          <Tree size={30} className="shrink-0 text-ok" />
          <div>
            <div className="num text-[15px] font-semibold text-ok">
              {results.length} из {results.length} — расхождений нет
            </div>
            <div className="text-[12.5px] text-muted">
              Файлы, локальный реестр и внешний реестр сходятся
            </div>
          </div>
        </div>
      )}

      <div className="flex flex-wrap items-center gap-2">
        {(Object.keys(counts) as AuditStatus[]).map((status) => (
          <Pill key={status} tone={AUDIT_TONE[status]}>
            {counts[status]} · {AUDIT_LABEL[status]}
          </Pill>
        ))}
      </div>

      <Card>
        {sorted.map((r) => {
          const bad = PROBLEM.includes(r.status)
          const remedy = REMEDY[r.status]

          return (
            <div
              key={r.id}
              className={`grid grid-cols-[3px_1fr_auto] gap-x-3.5 border-b border-line py-3 pr-3.5 last:border-0 ${
                bad ? "bg-err-bg/40" : ""
              }`}
            >
              <div className={`rounded-sm ${bad ? "bg-err" : "bg-transparent"}`} />

              <div className="min-w-0">
                <div className="truncate font-medium">{r.file_path}</div>
                <div className={`mt-0.5 text-[12px] ${bad ? "text-err" : "text-muted"}`}>
                  {EXPLAIN[r.status]}
                </div>

                <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-0.5 text-[11.5px]">
                  {r.status === "HASH_MISMATCH" ? (
                    <>
                      <span className="text-faint">
                        ожидался <Hash value={r.stored_hash} onCopied={onCopied} />
                      </span>
                      <span className="text-faint">
                        фактический <Hash value={r.current_hash} onCopied={onCopied} />
                      </span>
                    </>
                  ) : (
                    <span className="text-faint">
                      заякорен <Hash value={r.stored_hash} onCopied={onCopied} />
                    </span>
                  )}
                  {r.registries?.length ? (
                    // Реестр — "chainId:контракт"; показываем целиком, по нему сверяют
                    <span className="mono text-faint">
                      {r.registries.map((reg) => `chainId ${reg.replace(":", " · ")}`).join(", ")}
                    </span>
                  ) : null}
                </div>

                {bad && remedy ? (
                  <div className="mt-2 rounded-[var(--radius-s)] border border-line bg-panel px-3 py-2">
                    <div className="text-[10.5px] font-semibold uppercase tracking-[0.08em] text-faint">
                      Что делать
                    </div>
                    <ul className="mt-1 grid list-none gap-1 p-0 text-[12px] text-muted">
                      {remedy.map((step, i) => (
                        <li key={i} className="flex gap-2">
                          <span className="text-faint">·</span>
                          <span>{step}</span>
                        </li>
                      ))}
                    </ul>
                    {r.status === "ON_CHAIN_MISSING" ? (
                      <button
                        onClick={onOpenQueue}
                        className="mt-1.5 text-[12px] font-medium text-accent-hi hover:underline"
                      >
                        Открыть очередь →
                      </button>
                    ) : null}
                  </div>
                ) : null}
              </div>

              <div className="flex items-start pt-0.5">
                <Pill tone={AUDIT_TONE[r.status]}>{AUDIT_LABEL[r.status]}</Pill>
              </div>
            </div>
          )
        })}
      </Card>
    </>
  )
}
