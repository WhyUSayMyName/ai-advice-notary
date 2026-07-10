/**
 * Детерминированная JSON-сериализация для канонических артефактов.
 *
 * Гарантии:
 * - ключи объектов сортируются лексикографически на всех уровнях;
 * - без пробелов и переводов строк;
 * - недетерминируемые значения (undefined, функции, NaN, Infinity, BigInt,
 *   Date и прочие не-JSON типы) вызывают ошибку, а не молча искажаются.
 *
 * Одинаковая логическая структура всегда даёт одинаковые байты — и,
 * следовательно, одинаковый хеш.
 */
export function stableStringify(value: unknown): string {
  return serialize(value, "$")
}

function serialize(value: unknown, path: string): string {
  if (value === null) return "null"

  switch (typeof value) {
    case "string":
      return JSON.stringify(value)
    case "boolean":
      return value ? "true" : "false"
    case "number":
      if (!Number.isFinite(value)) {
        throw new Error(`Недетерминируемое число в ${path}: ${value}`)
      }
      return JSON.stringify(value)
    case "object":
      break
    default:
      throw new Error(`Несериализуемый тип в ${path}: ${typeof value}`)
  }

  if (Array.isArray(value)) {
    return "[" + value.map((v, i) => serialize(v, `${path}[${i}]`)).join(",") + "]"
  }

  if (Object.getPrototypeOf(value) !== Object.prototype && Object.getPrototypeOf(value) !== null) {
    throw new Error(`Только простые объекты допустимы в каноне (${path})`)
  }

  const entries = Object.entries(value as Record<string, unknown>)
    .filter(([, v]) => v !== undefined)
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))

  return (
    "{" +
    entries.map(([k, v]) => `${JSON.stringify(k)}:${serialize(v, `${path}.${k}`)}`).join(",") +
    "}"
  )
}
