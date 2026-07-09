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

## Next
- **Phase 5 — Economics and real networks.**
  Merkle-tree batching (`anchorRoot`): hundreds of documents per transaction,
  per-document Merkle proofs in the evidence bundle; public testnet deployment;
  experimental evaluation (cost, latency, throughput — scenarios S1–S4,
  metrics M1–M6 from the research plan) with published results.
- **Phase 6 — Production readiness.**
  Key management outside `.env` (OS-encrypted storage / external anchor service),
  CI (contract + app tests + lint), UI redesign and decomposition of `App.tsx`.

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
фиксаций с ретраями и восстановлением после сбоя без дублей on-chain.

**Дальше:** этап 5 — Merkle-батчинг, testnet, экспериментальная оценка
(стоимость/латентность/пропускная способность); этап 6 — управление ключами,
CI, редизайн UI.

**Исследовательский трек:** канонизация структурированных артефактов и
LLM-диалогов, научная публикация результатов экспериментов.
