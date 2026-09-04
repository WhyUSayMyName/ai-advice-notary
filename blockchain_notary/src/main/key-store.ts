import { app, safeStorage } from "electron"
import { createKeyStore, type KeyStore } from "./key-store-core"

export type { KeyStatus, KeyOrigin } from "./key-store-core"

let instance: KeyStore | null = null

/**
 * Хранилище ключа поверх safeStorage Electron: DPAPI в Windows, Keychain
 * в macOS, libsecret в Linux. Ключ шифрования принадлежит учётной записи
 * пользователя, поэтому унесённый файл на чужой машине не расшифровывается.
 */
export function getKeyStore(): KeyStore {
  if (!instance) {
    instance = createKeyStore(app.getPath("userData"), {
      available: () => safeStorage.isEncryptionAvailable(),
      encrypt: (plain) => safeStorage.encryptString(plain),
      decrypt: (blob) => safeStorage.decryptString(blob),
    })
  }
  return instance
}
