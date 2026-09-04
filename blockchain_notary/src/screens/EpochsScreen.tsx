import { Card, EmptyState, Hash, Pill, SectionLabel } from "../components/ui"
import { formatTime } from "../components/format"

/**
 * Кольца эпох — четвёртый ярус метафоры: ствол как связанный реестр фиксаций.
 * Каждая эпоха коммитится к предыдущей: Cₙ = SHA-256(0x02 ‖ Cₙ₋₁ ‖ rootₙ),
 * и on-chain уходит голова Cₙ. Изъять кольцо из середины нельзя незаметно.
 *
 * Вердикт непрерывности приходит из main-процесса, где считается тем же
 * каноном, которым пользуется независимый верификатор аудитора.
 */
export function EpochsScreen({
  batches,
  chain,
  onCopied,
}: {
  batches: AnchorBatchSummary[]
  chain?: ChainVerdict
  onCopied: (v: string) => void
}) {
  if (batches.length === 0) {
    return (
      <Card>
        <EmptyState
          title="Ствол ещё не начал расти"
          hint="Кольцо появляется, когда несколько документов фиксируются одним пакетом. Поставьте в очередь хотя бы два — и первая эпоха закроется одной транзакцией."
        />
      </Card>
    )
  }

  const total = batches.reduce((sum, b) => sum + b.leaf_count, 0)
  const confirmed = batches.filter((b) => b.tx_hash).length
  // Внешнее кольцо — последняя эпоха; к центру уходят более ранние
  const rings = batches.slice(0, 12)
  const maxR = 96

  return (
    <>
      <div className="grid gap-3 lg:grid-cols-[260px_1fr]">
        <Card className="flex items-center justify-center p-4">
          <svg width="212" height="212" viewBox="-106 -106 212 212" role="img"
               aria-label={`Срез ствола: ${rings.length} колец`}>
            <defs>
              <radialGradient id="core" cx="50%" cy="50%">
                <stop offset="0%" stopColor="var(--ok)" stopOpacity=".35" />
                <stop offset="100%" stopColor="var(--ok)" stopOpacity="0" />
              </radialGradient>
            </defs>
            <circle r={maxR} fill="url(#core)" />
            {rings.map((b, i) => {
              // i=0 — самая свежая эпоха, она же внешнее кольцо
              const r = maxR - (i * maxR) / (rings.length + 1)
              const newest = i === 0
              return (
                <circle
                  key={b.root}
                  r={r}
                  fill="none"
                  stroke={newest ? "var(--ok)" : "var(--border2)"}
                  strokeWidth={newest ? 2 : 1}
                  opacity={newest ? 1 : 0.4 + (0.5 * (rings.length - i)) / rings.length}
                />
              )
            })}
            <circle r="3" fill="var(--accent)" />
          </svg>
        </Card>

        <Card className="p-4">
          <SectionLabel>Ствол</SectionLabel>
          <dl className="mt-2.5 grid grid-cols-[190px_1fr] gap-x-3.5 gap-y-1.5 text-[12.5px]">
            <dt className="text-muted">Эпох (пакетов)</dt>
            <dd className="num">{batches.length}</dd>

            <dt className="text-muted">Документов в пакетах</dt>
            <dd className="num">{total}</dd>

            <dt className="text-muted">Транзакций потрачено</dt>
            <dd className="num">
              {confirmed}
              {total > confirmed ? (
                <span className="ml-2 text-muted">
                  вместо {total} — экономия {total > 0 ? Math.round((1 - confirmed / total) * 100) : 0}%
                </span>
              ) : null}
            </dd>

            <dt className="text-muted">Непрерывность</dt>
            <dd>
              {chain?.ok ? (
                <Pill tone="ok">цепочка цела · {chain.length} звеньев</Pill>
              ) : chain ? (
                <Pill tone="err">разрыв на звене {chain.brokenAt + 1}</Pill>
              ) : (
                <Pill tone="mut">не проверялась</Pill>
              )}
            </dd>

            {chain?.ok ? (
              <>
                <dt className="text-muted">Голова цепи</dt>
                <dd>
                  <Hash value={chain.head} onCopied={onCopied} />
                </dd>
              </>
            ) : null}
          </dl>

          {chain && !chain.ok ? (
            <p className="mt-3 max-w-[68ch] text-[12px] text-err">{chain.reason}</p>
          ) : (
            <p className="mt-3 max-w-[68ch] text-[12px] text-muted">
              Каждая эпоха коммитится к предыдущей:{" "}
              <span className="mono text-faint">Cₙ = H(Cₙ₋₁ ‖ rootₙ)</span>. On-chain уходит
              голова цепи, поэтому изъять эпоху из середины истории незаметно нельзя —
              разрыв обнаружится при проверке. Опубликуйте голову независимой стороне,
              и она зафиксирует всю историю до этого момента.
            </p>
          )}
        </Card>
      </div>

      <div>
        <SectionLabel>Эпохи</SectionLabel>
        <Card className="mt-2">
          {batches.map((b, i) => (
            <div
              key={b.root}
              className="flex items-center gap-3 border-b border-line px-3.5 py-2.5 last:border-0"
            >
              <span
                className={`num w-9 shrink-0 text-[12px] ${i === 0 ? "text-ok" : "text-faint"}`}
              >
                #{batches.length - i}
              </span>

              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="text-[12.5px] text-muted">корень</span>
                  <Hash value={b.root} onCopied={onCopied} />
                  {i === 0 ? <Pill tone="ok">последняя</Pill> : null}
                  {b.chain_root ? null : <Pill tone="mut">без связки</Pill>}
                </div>
                <div className="num mt-0.5 text-[11.5px] text-faint">
                  {b.leaf_count} документов · {formatTime(b.created_at)}
                </div>
                {b.chain_root ? (
                  <div className="mt-0.5 flex flex-wrap items-center gap-1.5 text-[11.5px] text-faint">
                    <span>звено</span>
                    <Hash value={b.prev_chain_root} onCopied={onCopied} />
                    <span aria-hidden="true">→</span>
                    <Hash value={b.chain_root} onCopied={onCopied} />
                  </div>
                ) : null}
              </div>

              <div className="shrink-0">
                {b.tx_hash ? (
                  <Hash value={b.tx_hash} onCopied={onCopied} className="text-[11.5px]" />
                ) : (
                  <Pill tone="warn">не отправлена</Pill>
                )}
              </div>
            </div>
          ))}
        </Card>
      </div>
    </>
  )
}
