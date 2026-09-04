#!/usr/bin/env node
/**
 * Сторож архитектурного принципа: верификатор аудитора не должен доверять
 * этому репозиторию.
 *
 * `verifier-cli/verify.mjs` — один читаемый файл с одной зависимостью, который
 * аудитор проверяет глазами. Любое разделение кода с приложением уничтожает
 * смысл: тогда проверка опирается на ту же реализацию, которую проверяет.
 * Принцип легко нарушить рефакторингом «заодно вынесем общее», поэтому он
 * проверяется механически, а не держится на памяти.
 *
 * Выход: 0 — всё в порядке, 1 — принцип нарушен.
 */
import fs from "node:fs"
import path from "node:path"
import { fileURLToPath } from "node:url"

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..")
const dir = path.join(root, "verifier-cli")

const ALLOWED_DEPS = ["ethers"]
const problems = []

// 1. Ровно одна зависимость, и та — ethers
const pkg = JSON.parse(fs.readFileSync(path.join(dir, "package.json"), "utf8"))
const deps = Object.keys(pkg.dependencies ?? {})
const devDeps = Object.keys(pkg.devDependencies ?? {})

if (deps.length !== ALLOWED_DEPS.length || !deps.every((d) => ALLOWED_DEPS.includes(d))) {
  problems.push(`зависимости verifier-cli: ожидалось [${ALLOWED_DEPS}], найдено [${deps}]`)
}
if (devDeps.length > 0) {
  problems.push(`у верификатора появились devDependencies: [${devDeps}]`)
}

// 2. Верификатор состоит из одного файла
const ownFiles = fs
  .readdirSync(dir)
  .filter((f) => f.endsWith(".mjs") || f.endsWith(".js") || f.endsWith(".ts"))

if (ownFiles.length !== 1 || ownFiles[0] !== "verify.mjs") {
  problems.push(`верификатор перестал быть одним файлом: [${ownFiles}]`)
}

// 3. Ни одного импорта за пределы каталога и ни одного — из приложения
const source = fs.readFileSync(path.join(dir, "verify.mjs"), "utf8")
const imports = [...source.matchAll(/(?:^|\s)(?:import|from)\s+["']([^"']+)["']/g)].map((m) => m[1])

for (const spec of imports) {
  const isNode = spec.startsWith("node:")
  const isAllowedDep = ALLOWED_DEPS.includes(spec)
  const escapesDir = spec.startsWith("../") || path.isAbsolute(spec)

  if (escapesDir || (!isNode && !isAllowedDep && !spec.startsWith("./"))) {
    problems.push(`запрещённый импорт в verify.mjs: ${spec}`)
  }
}

// 4. Никакого SQLite: верификатор читает пакет доказательств, а не базу оператора
if (/better-sqlite3|sqlite/i.test(source)) {
  problems.push("verify.mjs упоминает SQLite — он не должен читать базу оператора")
}

if (problems.length > 0) {
  console.error("Изоляция верификатора нарушена:")
  for (const p of problems) console.error(`  - ${p}`)
  console.error("\nСм. CLAUDE.md, принцип 2: аудитор не должен доверять этому репозиторию.")
  process.exit(1)
}

console.log(`Изоляция верификатора в порядке: ${ownFiles[0]}, зависимости [${deps}]`)
