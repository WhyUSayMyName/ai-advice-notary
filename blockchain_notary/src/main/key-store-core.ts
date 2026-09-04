import fs from "node:fs"
import path from "node:path"
import { Wallet } from "ethers"

/**
 * Шифр операционной системы: DPAPI в Windows, Keychain в macOS, libsecret
 * в Linux. Ключ шифрования принадлежит учётной записи пользователя, поэтому
 * файл, унесённый на другую машину, бесполезен. Инъецируется, чтобы ядро
 * не зависело от Electron и тестировалось без него.
 */
export type Cipher = {
  available(): boolean
  encrypt(plain: string): Buffer
  decrypt(blob: Buffer): string
}

export type KeyOrigin = "store" | "env" | "none"

export type KeyStatus = {
  /** Откуда воркер возьмёт ключ прямо сейчас */
  origin: KeyOrigin
  /** ОС умеет шифровать; если нет — сохранить ключ нельзя */
  encryptionAvailable: boolean
  /**
   * Адрес подписанта. Показывает, ЧЕЙ ключ лежит, не раскрывая сам ключ:
   * оператор должен видеть, что подписывает не чужая учётка.
   */
  address: string | null
  /**
   * NOTARY_PK найден в окружении. Это открытый текст на диске — терпимо для
   * разработки, недопустимо для рабочей установки, и интерфейс обязан
   * об этом говорить.
   */
  envKeyPresent: boolean
}

export type KeyStore = {
  status(): KeyStatus
  /** Сохраняет ключ зашифрованным. Возвращает адрес подписанта. */
  save(privateKey: string): string
  /** Удаляет сохранённый ключ. Ключ из окружения этим не убрать. */
  clear(): void
  /**
   * Ключ для подписи транзакций — только для main-процесса.
   * НИКОГДА не отдавать в renderer, в лог или в IPC-ответ.
   */
  read(): string | null
}

const KEY_RE = /^0x[0-9a-f]{64}$/

/** Приводит к каноническому виду и падает на всём, что не похоже на ключ. */
export function normalizePrivateKey(raw: string): string {
  const trimmed = raw.trim().toLowerCase()
  const lower = trimmed.startsWith("0x") ? trimmed : `0x${trimmed}`

  if (!KEY_RE.test(lower)) {
    throw new Error("Приватный ключ должен быть 64 hex-символами, с 0x или без")
  }
  // Нулевой ключ формально проходит проверку длины, но не является скаляром
  // на кривой secp256k1 — Wallet бросит своё исключение, поймаем его здесь.
  try {
    new Wallet(lower)
  } catch {
    throw new Error("Приватный ключ не является допустимым для secp256k1")
  }
  return lower
}

/** Адрес по приватному ключу; null, если ключ испорчен. */
export function addressOf(privateKey: string): string | null {
  try {
    return new Wallet(normalizePrivateKey(privateKey)).address
  } catch {
    return null
  }
}

export function createKeyStore(
  dir: string,
  cipher: Cipher,
  /** Обычно () => process.env.NOTARY_PK */
  envKey: () => string | undefined = () => process.env.NOTARY_PK
): KeyStore {
  const file = path.join(dir, "notary-key.enc")

  const readStored = (): string | null => {
    if (!fs.existsSync(file)) return null
    try {
      return normalizePrivateKey(cipher.decrypt(fs.readFileSync(file)))
    } catch {
      // Файл от другой учётной записи или повреждён. Молча вернуть null
      // безопаснее, чем уронить приложение: ключ можно ввести заново.
      return null
    }
  }

  const readEnv = (): string | null => {
    const raw = envKey()
    if (!raw) return null
    try {
      return normalizePrivateKey(raw)
    } catch {
      return null
    }
  }

  const read = (): string | null => readStored() ?? readEnv()

  return {
    read,

    status() {
      const stored = readStored()
      const env = readEnv()
      const active = stored ?? env

      return {
        origin: stored ? "store" : env ? "env" : "none",
        encryptionAvailable: cipher.available(),
        address: active ? addressOf(active) : null,
        envKeyPresent: Boolean(envKey()),
      }
    },

    save(privateKey) {
      if (!cipher.available()) {
        throw new Error(
          "Операционная система не предоставляет защищённое хранилище — сохранить ключ нельзя"
        )
      }
      const normalized = normalizePrivateKey(privateKey)
      fs.mkdirSync(dir, { recursive: true })
      // Права 0600: на POSIX файл не должен читаться другими пользователями.
      // На Windows режим игнорируется, там защиту даёт сам DPAPI.
      fs.writeFileSync(file, cipher.encrypt(normalized), { mode: 0o600 })
      return new Wallet(normalized).address
    },

    clear() {
      fs.rmSync(file, { force: true })
    },
  }
}
