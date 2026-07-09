# notary-verify

Independent verifier for [AI Advice Notary](../README.md).

**Why it exists.** The threat model assumes the operator of the document storage
is *not trusted*. An auditor therefore must not rely on the operator's app to
check integrity. This CLI is a single readable file with one dependency
(`ethers`): review it, point it at a JSON-RPC node **you** trust, and verify
documents yourself.

## Install

```shell
cd verifier-cli
npm install
```

## Verify individual files

```shell
node verify.mjs report.pdf journal.xlsx \
  --contract 0x5FbDB2315678afecb367f032d93F642f64180aa3 \
  --rpc http://127.0.0.1:8545
```

Output per file: `NOTARIZED` (with on-chain author and timestamp) or `NOT_FOUND`.

## Verify an evidence bundle

The operator's app exports an evidence bundle (`notary-evidence/v1` JSON) with
the expected hashes, versions and the contract address. Put it next to the
documents being audited:

```shell
node verify.mjs --bundle evidence.json --dir ./documents --rpc <url>
```

Verdicts:

| Status | Meaning |
|---|---|
| `OK_ON_CHAIN` | file matches the bundle hash and is anchored on-chain |
| `OK_HISTORICAL` | older version: its hash is anchored on-chain (file itself is not compared) |
| `TAMPERED` | file content differs from the recorded hash; if the recorded hash *is* on-chain, notarized content was modified |
| `MISSING_FILE` | bundle references a file that is absent — possible destruction of evidence |
| `NOT_ON_CHAIN` | bundle claims notarization but the registry has no such record |
| `LOCAL_ONLY` | entry was never notarized (informational) |

Exit code `0` — everything checks out; `2` — at least one problem found.

Add `--json` for machine-readable output.

## Trust notes

- Run against your **own** or an independently operated RPC node. If you use the
  operator's node, they control the answers.
- The contract address must come from an out-of-band source you trust
  (regulator's registry, a signed statement, this repository's deployment docs)
  — not only from the bundle itself.

---

## RU (кратко)

Независимый верификатор: аудитор не должен доверять приложению оператора.
Один читаемый файл, одна зависимость. Проверка отдельных файлов
(`node verify.mjs <файлы> --contract <адрес> --rpc <url>`) или пакета
доказательств, экспортированного из приложения
(`node verify.mjs --bundle evidence.json --dir <папка-с-документами> --rpc <url>`).
Используйте собственный RPC-узел, а адрес контракта берите из независимого
источника, а не только из самого пакета.
