import { Card, EmptyState, Pill, short, formatTime } from "../components/ui"

const LABEL: Record<AnchorStatus, string> = {
  pending: "В очереди",
  sent: "Отправлено",
  confirmed: "Подтверждено",
  failed: "Не удалось",
}

const TONE: Record<AnchorStatus, "ok" | "warn" | "info" | "err"> = {
  pending: "warn",
  sent: "info",
  confirmed: "ok",
  failed: "err",
}

export function QueueScreen({ queue }: { queue: AnchorQueueItem[] }) {
  const pending = queue.filter((q) => q.status === "pending" || q.status === "sent")
  const confirmed = queue.filter((q) => q.status === "confirmed")
  const failed = queue.filter((q) => q.status === "failed")

  return (
    <>
      <div className="flex flex-wrap items-center gap-4 rounded-[9px] border border-line bg-gradient-to-r from-accent-bg to-transparent px-4 py-3.5">
        <div>
          <div className="text-[11px] text-muted">Ожидают фиксации</div>
          <div className="num mt-0.5 text-[20px] font-semibold tracking-[-0.01em]">
            {pending.length}
          </div>
        </div>
        <div>
          <div className="text-[11px] text-muted">Подтверждено</div>
          <div className="num mt-0.5 text-[15px] font-semibold">{confirmed.length}</div>
        </div>
        {failed.length > 0 ? (
          <div>
            <div className="text-[11px] text-muted">С ошибкой</div>
            <div className="num mt-0.5 text-[15px] font-semibold text-err">{failed.length}</div>
          </div>
        ) : null}
        <div className="ml-auto">
          {pending.length > 1 ? (
            <Pill tone="acc">пакетная фиксация: {pending.length} → 1 транзакция</Pill>
          ) : (
            <Pill tone="acc">воркер активен</Pill>
          )}
        </div>
      </div>

      <Card>
        {queue.length === 0 ? (
          <EmptyState
            title="Очередь пуста"
            hint="Хеши попадают сюда при нотаризации и остаются, пока не подтвердятся во внешнем реестре — даже если приложение перезапустить."
          />
        ) : (
          queue.map((q) => (
            <div
              key={q.id}
              className="flex items-center gap-3 border-b border-line px-3.5 py-2.5 last:border-0"
            >
              <Pill tone={TONE[q.status]}>{LABEL[q.status]}</Pill>

              <div className="min-w-0 flex-1">
                <div className="mono truncate">{q.hash}</div>
                <div className="text-[11.5px] text-muted">
                  {q.attempts > 0 ? `попытка ${q.attempts} · ` : ""}
                  {q.last_error ? q.last_error : formatTime(q.created_at)}
                </div>
              </div>

              {q.tx_hash ? (
                <span className="mono shrink-0 text-[11.5px] text-muted">
                  tx {short(q.tx_hash, 5)}
                </span>
              ) : null}
            </div>
          ))
        )}
      </Card>
    </>
  )
}
