import { describe, it, expect, beforeEach, afterEach } from "vitest"
import fs from "node:fs"
import os from "node:os"
import path from "node:path"
import { createKeyStore, normalizePrivateKey, addressOf, type Cipher } from "../key-store-core"

// Account #0 из hardhat node — публично известный тестовый ключ
const PK = "0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80"
const ADDRESS = "0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266"
const PK2 = "0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d"

/** Подделка DPAPI: xor вместо шифра — ядру важен только контракт */
function fakeCipher(available = true): Cipher {
  return {
    available: () => available,
    encrypt: (plain) => Buffer.from([...Buffer.from(plain, "utf8")].map((b) => b ^ 0x5a)),
    decrypt: (blob) => Buffer.from([...blob].map((b) => b ^ 0x5a)).toString("utf8"),
  }
}

let dir: string

beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), "keystore-"))
})

afterEach(() => {
  fs.rmSync(dir, { recursive: true, force: true })
})

describe("normalizePrivateKey", () => {
  it("принимает ключ с 0x и без, приводит к нижнему регистру", () => {
    expect(normalizePrivateKey(PK)).toBe(PK)
    expect(normalizePrivateKey(PK.slice(2))).toBe(PK)
    expect(normalizePrivateKey(`  ${PK.toUpperCase()}  `)).toBe(PK)
  })

  it("отвергает мусор, короткие и нескалярные значения", () => {
    expect(() => normalizePrivateKey("")).toThrow()
    expect(() => normalizePrivateKey("0xdeadbeef")).toThrow()
    expect(() => normalizePrivateKey(`${PK}ff`)).toThrow()
    expect(() => normalizePrivateKey("0xzz74bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80")).toThrow()
    // Ноль — валидная длина, но недопустимый скаляр secp256k1
    expect(() => normalizePrivateKey(`0x${"0".repeat(64)}`)).toThrow()
  })

  it("выводит адрес, не раскрывая ключ", () => {
    expect(addressOf(PK)).toBe(ADDRESS)
    expect(addressOf("мусор")).toBeNull()
  })
})

describe("createKeyStore", () => {
  it("без ключа — origin none", () => {
    const store = createKeyStore(dir, fakeCipher(), () => undefined)

    expect(store.status()).toMatchObject({
      origin: "none",
      address: null,
      envKeyPresent: false,
      encryptionAvailable: true,
    })
    expect(store.read()).toBeNull()
  })

  it("сохраняет, читает и удаляет ключ", () => {
    const store = createKeyStore(dir, fakeCipher(), () => undefined)

    expect(store.save(PK)).toBe(ADDRESS)
    expect(store.read()).toBe(PK)
    expect(store.status()).toMatchObject({ origin: "store", address: ADDRESS })

    store.clear()
    expect(store.read()).toBeNull()
    expect(store.status().origin).toBe("none")
  })

  it("на диск ключ попадает только зашифрованным", () => {
    createKeyStore(dir, fakeCipher(), () => undefined).save(PK)
    const raw = fs.readFileSync(path.join(dir, "notary-key.enc"))

    expect(raw.toString("utf8")).not.toContain(PK.slice(2))
    expect(raw.toString("latin1")).not.toContain(PK.slice(2))
  })

  // Открытый ключ в .env — известный долг. Он обязан оставаться видимым:
  // если интерфейс о нём молчит, оператор так и уедет в прод с ключом на диске.
  it("ключ из окружения работает, но помечается как env", () => {
    const store = createKeyStore(dir, fakeCipher(), () => PK)

    expect(store.read()).toBe(PK)
    expect(store.status()).toMatchObject({
      origin: "env",
      address: ADDRESS,
      envKeyPresent: true,
    })
  })

  it("сохранённый ключ имеет приоритет над окружением", () => {
    const store = createKeyStore(dir, fakeCipher(), () => PK)
    store.save(PK2)

    expect(store.read()).toBe(PK2)
    expect(store.status()).toMatchObject({ origin: "store", envKeyPresent: true })
  })

  it("мусор в окружении не считается ключом", () => {
    const store = createKeyStore(dir, fakeCipher(), () => "не ключ")

    expect(store.read()).toBeNull()
    expect(store.status()).toMatchObject({ origin: "none", envKeyPresent: true, address: null })
  })

  // Файл, скопированный с чужой машины, DPAPI расшифровать не сможет.
  // Приложение должно продолжать работать, а не падать при старте.
  it("нечитаемый файл ключа не роняет приложение", () => {
    createKeyStore(dir, fakeCipher(), () => undefined).save(PK)
    fs.writeFileSync(path.join(dir, "notary-key.enc"), Buffer.from([1, 2, 3, 4]))

    const store = createKeyStore(dir, fakeCipher(), () => undefined)
    expect(store.read()).toBeNull()
    expect(store.status().origin).toBe("none")
  })

  it("без шифрования ОС ключ сохранить нельзя", () => {
    const store = createKeyStore(dir, fakeCipher(false), () => undefined)

    expect(() => store.save(PK)).toThrow(/защищённое хранилище/)
    expect(store.status().encryptionAvailable).toBe(false)
  })

  it("save отвергает испорченный ключ до записи на диск", () => {
    const store = createKeyStore(dir, fakeCipher(), () => undefined)

    expect(() => store.save("0xdeadbeef")).toThrow()
    expect(fs.existsSync(path.join(dir, "notary-key.enc"))).toBe(false)
  })
})
