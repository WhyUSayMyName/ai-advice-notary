/**
 * Реестр — пара «сеть + адрес контракта», в которой лежит заякоренное значение.
 *
 * Сам по себе хеш не говорит, где его искать: тот же документ можно заякорить
 * на локальном узле и в Sepolia, а отсутствие в одном реестре ничего не
 * говорит о другом. Для системы, где «нет в реестре» означает «подозрение на
 * фальсификацию», проверка в чужом реестре — ложная тревога, поэтому каждая
 * фиксация помнит свой реестр, а аудит сверяется только со своим.
 *
 * Идентификатор: "<chainId>:<адрес контракта в нижнем регистре>" — читаемый
 * и однозначный; регистр адреса нормализуется, иначе checksum-запись
 * и запись строчными дали бы два «разных» реестра.
 */

export function registryId(chainId: number | bigint, contract: string): string {
  if (!/^0x[0-9a-fA-F]{40}$/.test(contract)) {
    throw new Error(`Некорректный адрес контракта: ${contract}`)
  }
  return `${chainId}:${contract.toLowerCase()}`
}

/** Разбор идентификатора — для интерфейса и сертификата. */
export function parseRegistryId(id: string): { chainId: number; contract: string } {
  const m = /^(\d+):(0x[0-9a-f]{40})$/.exec(id)
  if (!m) throw new Error(`Некорректный идентификатор реестра: ${id}`)
  return { chainId: Number(m[1]), contract: m[2] }
}

/**
 * Где проверять документ относительно текущего реестра.
 *
 * - "current" — по данным базы фиксация была в текущем реестре: проверяем,
 *   и отсутствие там — настоящая тревога;
 * - "unknown" — фиксация сделана до учёта реестров: проверяем в текущем,
 *   но отсутствие означает лишь «здесь не найдено», а не подмену;
 * - "elsewhere" — заякорено только в других реестрах: здесь проверять нечего.
 *
 * Если известен хоть один якорь в текущем реестре, он и решает: неизвестные
 * рядом с ним тревогу не смягчают.
 */
export type AnchorScope =
  | { kind: "current" }
  | { kind: "unknown" }
  | { kind: "elsewhere"; registries: string[] }

export function anchorScope(registries: Array<string | null>, current: string): AnchorScope {
  if (registries.includes(current)) return { kind: "current" }
  // Пустой список — запись помечена заякоренной, но следов якоря в базе нет
  // (фиксация старше очереди): это тоже неизвестность, а не «в другом месте»
  if (registries.length === 0 || registries.includes(null)) return { kind: "unknown" }
  return { kind: "elsewhere", registries: registries.filter((r): r is string => r !== null) }
}
