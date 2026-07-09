# Roadmap

Goal: bring the project from a working research prototype to a production-ready
system for provable integrity of digital documents and AI-generated advice.

## Done

- **Phase 0 — Repo hygiene.** Cleaned repository, `.env.example`, rewritten READMEs.
- **Phase 1 — Single contract.** One `Notary` contract, 6 contract tests,
  ABI exported from hardhat artifacts as the single source of truth for the client.
- **Phase 2 — Robust local data layer.** Per-artifact uniqueness
  (`UNIQUE(artifact_id, hash)`) with legacy-schema migration, explicit hash-conflict
  handling instead of silent `INSERT OR IGNORE`, transactional version creation,
  17 unit tests (vitest).

- **Phase 3 — Independent verifier (key milestone).**
  Standalone CLI (`verifier-cli/`): single readable file, one dependency,
  no Electron, no SQLite. Verifies individual files or an evidence bundle
  (`notary-evidence/v1`) exported from the app; distinguishes TAMPERED /
  MISSING_FILE / NOT_ON_CHAIN / LOCAL_ONLY / OK_HISTORICAL. End-to-end
  acceptance: a single flipped byte in a notarized document is detected
  without access to the operator's database.

- **Phase 4 — Anchor service.**
  Persistent notarization queue in SQLite: sequential worker (no nonce races),
  exponential backoff with an attempt limit, deduplication by hash, live
  status events in the UI. Crash recovery on startup reconciles unconfirmed
  records against the chain: a transaction that was mined while the app was
  down is confirmed without re-sending. Verified by unit tests and a live
  e2e test against a real node (simulated crash after send).

- **Phase 5.1 — Merkle batching.**
  Canonical Merkle tree (domain-separated leaves and nodes, sorted pairs,
  odd-node promotion), `anchorRoot(root, leafCount)` in the contract, batch
  mode in the anchor worker (N due documents → one transaction), evidence
  bundle v2 with per-document proofs, proof folding in the CLI verifier
  (`BAD_PROOF` verdict). Live e2e: 100 documents anchored by a single
  transaction, each verifiable by an auditor; batch-aware audit and crash
  recovery via the root.

## Next
- **Phase 5.2 — Real networks and experiments.**
  Public testnet deployment; experimental evaluation (cost, latency,
  throughput — scenarios S1–S4, metrics M1–M6 from the research plan,
  single vs batched anchoring) with published results.
- **Phase 6 — Production readiness.**
  Key management outside `.env` (OS-encrypted storage / external anchor service),
  CI (contract + app tests + lint), UI redesign and decomposition of `App.tsx`.
- **Phase 7 — Integration layer (EDMS/СЭД).**
  Extract the electron-free core (`database-core`, `anchor-service`,
  `merkle-core`, `evidence-core`) into a `notary-core` package and ship a
  headless sidecar service on top of it: REST API (`POST /artifacts` accepting
  a file or a bare hash, confirmation webhooks, evidence bundle export) plus a
  zero-integration folder-watcher mode. EDMS workflow engines (Directum RX,
  ELMA365, 1C:DO, Docsvision, Tessa) call the API on document lifecycle events;
  hash-idempotent enqueueing makes retries from workflows safe. The desktop app
  remains the standalone mode for small organizations. Positioning: a
  provability layer on top of an existing EDMS — anchoring complements
  qualified e-signatures (authorship) with proof of existence in time that
  even the EDMS administrator cannot rewrite.

## Research track

- Canonicalization of structured artifacts (JSON, CSV) and **LLM dialogs** —
  provable fixation of AI-generated advice (salted hash format prototyped earlier
  in git history).
- Academic publication of the experimental evaluation.

---

# Дорожная карта (RU)

Цель: довести проект от работающего исследовательского прототипа до продакшена.

**Сделано:** этап 0 — гигиена репозитория; этап 1 — единый контракт `Notary`
с тестами и единым источником ABI; этап 2 — надёжный слой данных
(уникальность в рамках артефакта, миграция, явные конфликты, юнит-тесты);
этап 3 — независимый CLI-верификатор (`verifier-cli/`) и экспорт «пакета
доказательств» из приложения: аудитор проверяет целостность документов,
не доверяя софту оператора; этап 4 — anchor-сервис: устойчивая очередь
фиксаций с ретраями и восстановлением после сбоя без дублей on-chain;
этап 5.1 — Merkle-батчинг: N документов одной транзакцией `anchorRoot`,
пруфы в пакете доказательств v2, проверка пруфов в CLI (живой e2e:
100 документов одной транзакцией).

**Дальше:** этап 5.2 — testnet и экспериментальная оценка
(стоимость/латентность/пропускная способность, одиночная vs пакетная
фиксация); этап 6 — управление ключами, CI, редизайн UI; этап 7 —
интеграционный слой для СЭД: выделение notary-core, headless-сервис с REST
API (файл или готовый хеш, webhook, выгрузка пакета доказательств) и режим
наблюдателя за папками; вызов из workflow-движков СЭД по событиям жизненного
цикла документа. Позиционирование: слой доказуемости поверх существующего
документооборота — дополнение к ЭП (авторство) доказательством существования
во времени, которое не может переписать даже администратор СЭД.

**Исследовательский трек:** канонизация структурированных артефактов и
LLM-диалогов, научная публикация результатов экспериментов.
