import { Card, SectionLabel } from "../components/ui"

export function EvidenceScreen({
  artifacts,
  anchored,
  chainId,
}: {
  artifacts: number
  anchored: number
  chainId: number | null
}) {
  return (
    <div className="grid gap-3 lg:grid-cols-2">
      <Card className="p-4">
        <SectionLabel>Что войдёт в пакет</SectionLabel>
        <dl className="mt-2.5 grid grid-cols-[150px_1fr] gap-x-3.5 gap-y-1.5 text-[12.5px]">
          <dt className="text-muted">Формат</dt>
          <dd className="mono">notary-evidence/v2</dd>

          <dt className="text-muted">Документов</dt>
          <dd className="num">{artifacts}</dd>

          <dt className="text-muted">Заякорено</dt>
          <dd className="num">{anchored}</dd>

          <dt className="text-muted">Сеть</dt>
          <dd className="num">{chainId !== null ? `chainId ${chainId}` : "не подключено"}</dd>
        </dl>
        <p className="mt-3 max-w-[56ch] text-[12px] text-muted">
          В пакет попадают хеши, версии, идентификаторы транзакций и merkle-пруфы — но не
          сами документы. Оригиналы не покидают эту машину.
        </p>
      </Card>

      <Card className="p-4">
        <SectionLabel>Проверка на стороне аудитора</SectionLabel>
        <ol className="mt-2.5 grid list-none gap-2 p-0 text-[12.5px]">
          {[
            "Передать аудитору документы, evidence.json и открытый verifier-cli",
            "Аудитор читает код верификатора — один файл, одна зависимость",
            "Проверка запускается через его собственный RPC-узел",
          ].map((step, i) => (
            <li key={i} className="flex gap-2.5">
              <span className="mt-px flex h-[18px] w-[18px] shrink-0 items-center justify-center rounded-full bg-accent-bg text-[10.5px] font-semibold text-accent-hi">
                {i + 1}
              </span>
              <span>{step}</span>
            </li>
          ))}
        </ol>

        <pre className="mono mt-3 overflow-x-auto rounded-[7px] border border-line bg-panel2 px-3 py-2.5 text-[11.5px] leading-[1.75]">
{`notary-verify --bundle evidence.json \\
    --dir ./документы --rpc <свой узел>

OK_ON_CHAIN    Журнал ТБ — цех №4.pdf v3
TAMPERED       Наряд-допуск №118.pdf`}
        </pre>

        <p className="mt-2.5 max-w-[56ch] text-[12px] text-faint">
          Адрес контракта аудитору следует получить из независимого источника, а не только
          из самого пакета.
        </p>
      </Card>
    </div>
  )
}
