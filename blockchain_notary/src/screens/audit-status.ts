// Подписи и тона статусов аудита — не компоненты, поэтому живут отдельно
// (иначе react-refresh не может горячо перезагрузить экран).

export const AUDIT_LABEL: Record<AuditStatus, string> = {
  ON_CHAIN_OK: "Заякорен",
  LOCAL_ONLY: "Локальный",
  MISSING_FILE: "Файл утрачен",
  HASH_MISMATCH: "Подмена",
  ON_CHAIN_MISSING: "Нет в реестре",
  OTHER_REGISTRY: "Другая сеть",
  REGISTRY_UNKNOWN: "Сеть не записана",
}

export const AUDIT_TONE: Record<AuditStatus, "ok" | "warn" | "err" | "mut"> = {
  ON_CHAIN_OK: "ok",
  LOCAL_ONLY: "mut",
  MISSING_FILE: "err",
  HASH_MISMATCH: "err",
  ON_CHAIN_MISSING: "warn",
  OTHER_REGISTRY: "mut",
  REGISTRY_UNKNOWN: "mut",
}
