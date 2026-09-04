// Форматтеры живут отдельно от компонентов: react-refresh не может горячо
// перезагрузить модуль, в котором рядом с компонентами лежат обычные функции.

/** Сокращает хеш до читаемого вида: 0x57ed…3a87 */
export function short(s: string | null | undefined, n = 6) {
  if (!s) return "—"
  if (s.length <= n * 2 + 3) return s
  return `${s.slice(0, n + 2)}…${s.slice(-n)}`
}

export function formatTime(ms: number) {
  return new Date(ms).toLocaleString("ru-RU", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  })
}

/** Имя файла и каталог по отдельности — в реестре путь не должен дублироваться */
export function fileName(p: string) {
  return p.split(/[\\/]/).pop() || p
}

export function fileDir(p: string) {
  const parts = p.split(/[\\/]/)
  parts.pop()
  return parts.join("\\")
}
