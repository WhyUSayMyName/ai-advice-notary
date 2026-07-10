# AI Advice Notary

**Provable integrity for digital documents and AI-generated advice.**

Documents stay off-chain with their owner; only a SHA-256 hash is anchored
on-chain as an independent source of trust. An external auditor can later
*prove* that a document was tampered with or destroyed — without trusting
the operator of the storage system.

The system **detects** tampering post factum; it does not prevent it.
The threat model, applicability boundaries and experiment plan are formalized
in the project's research documentation.

## Why

- **AI accountability.** When advice from an LLM leads to consequences, there is
  no reliable way to establish what exactly the model said and what was altered
  afterwards. Anchoring dialog hashes makes the developer-vs-model responsibility
  boundary technically verifiable.
- **Conflict of interest.** Safety logs, technical documentation and reports are
  stored by the same organization that may be interested in rewriting them before
  an external audit. Classic backups and signatures don't help — keys and logs
  belong to the same operator.
- **A layer, not a replacement.** The system is designed to sit on top of an
  existing EDMS (via a sidecar API called from workflow events, or a
  folder-watcher) and to run standalone as a desktop app — see
  [ROADMAP.md](ROADMAP.md), phase 7.

## What works today

- Desktop app (Electron + React): file hashing, local registry (SQLite),
  document versioning with integrity-checked `previous_hash` chains,
  five-status audit, PDF certificates, evidence bundle export for auditors.
- `Notary` smart contract (Solidity, Hardhat) — an append-only hash registry.
- **Independent CLI verifier** ([verifier-cli/](verifier-cli/README.md)):
  a single readable file with one dependency that lets an auditor verify
  documents *without trusting the operator's software* — the key piece of
  the trust model.
- **Anchor service**: persistent notarization queue with retries and crash
  recovery — a transaction mined while the app was down is confirmed on
  restart without creating an on-chain duplicate.
- **Merkle batching**: N documents anchored by a single transaction
  (`anchorRoot`); per-document proofs travel in the evidence bundle and are
  verified by the CLI.
- **LLM accountability (MCP server)**: canonical dialog fixation
  (`notary-dialog/v1`) and human attestation acts (`notary-attestation/v1`)
  callable from Claude Code or any MCP client — see below.
- **Merkle batching**: N pending documents are anchored by a single
  `anchorRoot` transaction; the evidence bundle carries a per-document proof
  and the CLI verifier folds it to the on-chain root (live e2e: 100 documents,
  one transaction).
- 60 automated tests (10 contract + 47 unit + 3 live e2e). See
  [ROADMAP.md](ROADMAP.md) for what's next.

## Repository layout

| Path | Purpose |
|---|---|
| `contracts/` | Solidity registry contract |
| `scripts/` | Hardhat deploy scripts |
| `test/` | Contract tests |
| `blockchain_notary/` | Electron + React desktop app |
| `verifier-cli/` | Independent auditor's verifier (Node.js CLI) |

## Quick start

```shell
npm install
cd blockchain_notary && npm install

# one command: local hardhat node + contract deploy + app
npm run dev:all
```

Before the first run, create `blockchain_notary/.env` from
[`.env.example`](blockchain_notary/.env.example) (set `NOTARY_PK` to Account #0
key printed by `npx hardhat node`).

Tests: `npx hardhat test` (contracts), `npm test` in `blockchain_notary/` (app).

## MCP server (LLM accountability)

Build once, then register in your MCP client:

```shell
cd blockchain_notary
npm run build:mcp
```

`.mcp.json` for Claude Code (project root):

```json
{
  "mcpServers": {
    "ai-advice-notary": {
      "command": "node",
      "args": ["blockchain_notary/dist-mcp/server.mjs"],
      "env": {
        "RPC_URL": "http://127.0.0.1:8545",
        "NOTARY_ADDRESS": "0x...",
        "NOTARY_PK": "0x..."
      }
    }
  }
}
```

Tools: `notarize_dialog` (canonicalize and anchor an LLM dialog),
`attest_decision` (a human act linking dialog hashes to a decision document),
`check_hash` (on-chain status). Without chain env vars the server runs in
enqueue-only mode; hashes are anchored once a worker gets node access.
The queue and registry are shared with the desktop app.

License: [MIT](LICENSE).

---

# AI Advice Notary (RU)

Система доказуемой фиксации неизменности цифровых данных: документы хранятся
off-chain, а их криптографические хеши (SHA-256) фиксируются в блокчейне как
независимый «якорь доверия». Это позволяет внешнему аудитору постфактум
обнаружить подмену или уничтожение документа, не доверяя оператору системы
хранения.

Система **обнаруживает** нарушения, но не предотвращает их — границы
применимости и модель угроз описаны в проектной документации.

## Состав репозитория

| Каталог | Назначение |
|---|---|
| `contracts/` | Смарт-контракты реестра фиксации (Solidity) |
| `scripts/` | Скрипты деплоя контрактов (Hardhat) |
| `test/` | Тесты контрактов |
| `blockchain_notary/` | Десктоп-приложение (Electron + React): хеширование, реестр артефактов, версии, аудит, PDF-сертификаты, экспорт пакета доказательств |
| `verifier-cli/` | Независимый верификатор для аудитора (Node.js CLI) |

## Требования

- Node.js 18+
- npm

## Установка

```shell
npm install
cd blockchain_notary
npm install
```

## Быстрый старт (всё одной командой)

```shell
cd blockchain_notary
npm run dev:all
```

Скрипт поднимает локальный узел Hardhat, деплоит контракт `Notary`
и запускает приложение (Vite + Electron).

Перед первым запуском создайте `blockchain_notary/.env` по образцу
[`blockchain_notary/.env.example`](blockchain_notary/.env.example) —
в `NOTARY_PK` укажите приватный ключ Account #0 из вывода `npx hardhat node`.

## Запуск по шагам

```shell
# 1. Локальный блокчейн-узел (оставить запущенным)
npx hardhat node

# 2. Деплой контракта (адрес запишется в .env автоматически)
npx hardhat run scripts/deploy-notary.ts --network localhost

# 3. Приложение
cd blockchain_notary
npm run dev
```

## Тесты

```shell
npx hardhat test          # контракты
cd blockchain_notary
npm test                  # приложение (vitest)
```

## Как это работает

1. **Фиксация** — приложение вычисляет SHA-256 файла и отправляет хеш в контракт
   `Notary`; on-chain сохраняются только хеш, адрес отправителя и момент времени.
   Оригинал документа никогда не покидает off-chain хранилище.
2. **Версионирование** — новые версии документа связываются в цепочку через
   `previous_hash`; целостность цепочек проверяется в приложении.
3. **Аудит** — для каждого артефакта сверяются локальный файл, запись в локальном
   реестре (SQLite) и запись on-chain. Возможные статусы: `ON_CHAIN_OK`,
   `LOCAL_ONLY`, `MISSING_FILE`, `HASH_MISMATCH`, `ON_CHAIN_MISSING`.

Дорожная карта: [ROADMAP.md](ROADMAP.md). Лицензия: [MIT](LICENSE).
