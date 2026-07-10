import "dotenv/config"
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js"
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js"
import { z } from "zod"
import { createDatabase } from "../main/database-core"
import { AnchorService } from "../main/anchor-service"
import {
  notaryIsNotarized,
  notaryGetRecord,
  notarySendNotarize,
  notarySendAnchorRoot,
} from "../main/notary"
import {
  attestDecision,
  defaultArtifactsDir,
  notarizeDialog,
  resolveSharedDbPath,
  type McpDeps,
} from "./mcp-core"

/**
 * MCP-сервер блокчейн-нотаризации LLM-диалогов.
 *
 * stdio-протокол: stdout принадлежит JSON-RPC, весь лог — строго в stderr.
 *
 * Конфигурация через env (обычно задаётся в .mcp.json клиента):
 *   NOTARY_DB_PATH  — путь к базе (по умолчанию общая с desktop-приложением)
 *   RPC_URL, NOTARY_ADDRESS, NOTARY_PK — доступ к чейну; без них сервер
 *   работает в режиме enqueue-only: хеши копятся в очереди и будут
 *   заякорены, когда воркер (здесь или в приложении) получит доступ к узлу.
 */

const log = (msg: string) => console.error(`[notary-mcp] ${msg}`)

const dbPath = resolveSharedDbPath()
const db = createDatabase(dbPath)
const artifactsDir = process.env.NOTARY_ARTIFACTS_DIR ?? defaultArtifactsDir(dbPath)

const chainConfigured = Boolean(
  process.env.RPC_URL && process.env.NOTARY_ADDRESS && process.env.NOTARY_PK
)

let deps: McpDeps

if (chainConfigured) {
  const service = new AnchorService(
    db,
    {
      isNotarized: async (hash, rpcUrl) => (await notaryIsNotarized(hash, rpcUrl)).notarized,
      sendNotarize: (hash, rpcUrl) => notarySendNotarize(hash, rpcUrl),
      sendAnchorRoot: (root, leafCount, rpcUrl) => notarySendAnchorRoot(root, leafCount, rpcUrl),
    },
    (hash, txHash) => db.markArtifactNotarized(hash, txHash ?? ""),
    (event) => log(`anchor: ${event.type} ${event.item.hash.slice(0, 10)}…`)
  )
  service
    .recover()
    .then((r) => {
      if (r.confirmed || r.requeued) {
        log(`recovery: confirmed=${r.confirmed}, requeued=${r.requeued}`)
      }
      service.start()
    })
    .catch((e) => log(`recovery failed: ${e instanceof Error ? e.message : e}`))

  deps = { db, enqueue: (hash) => service.enqueue(hash), artifactsDir }
  log("чейн сконфигурирован — anchor-воркер запущен")
} else {
  deps = { db, enqueue: (hash) => db.enqueueAnchor(hash), artifactsDir }
  log("RPC_URL/NOTARY_ADDRESS/NOTARY_PK не заданы — режим enqueue-only")
}

log(`база: ${dbPath}`)
log(`артефакты: ${artifactsDir}`)

const server = new McpServer({ name: "ai-advice-notary", version: "0.1.0" })

const messageSchema = z.object({
  role: z.enum(["system", "user", "assistant", "tool"]),
  content: z.string(),
})

server.tool(
  "notarize_dialog",
  "Зафиксировать диалог с LLM: канонизация → SHA-256 с солью → очередь блокчейн-якорения. " +
    "Возвращает хеш, по которому диалог позже проверяется независимым верификатором.",
  {
    provider: z.string().describe("Провайдер модели: anthropic, openai, local…"),
    model: z.string().describe("Идентификатор модели, например claude-fable-5"),
    messages: z.array(messageSchema).min(1).describe("Сообщения диалога в хронологическом порядке"),
    params: z
      .record(z.union([z.string(), z.number(), z.boolean()]))
      .optional()
      .describe("Параметры генерации (temperature и т.п.)"),
    started_at: z.string().optional().describe("Начало диалога, ISO 8601"),
  },
  async (args) => {
    const result = notarizeDialog(deps, args)
    return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }] }
  }
)

server.tool(
  "attest_decision",
  "Акт аттестации человеком: «я рассмотрел эти диалоги и утвердил/доработал/отклонил решение». " +
    "Связывает хеши диалогов с документом-решением — вторая половина цепочки ответственности.",
  {
    attestor: z.string().describe("Кто утверждает: ФИО / email / табельный идентификатор"),
    verdict: z
      .enum(["approved", "approved_with_changes", "rejected"])
      .describe("approved — принято как есть; approved_with_changes — доработано; rejected — отклонено"),
    dialog_hashes: z
      .array(z.string().regex(/^0x[0-9a-f]{64}$/))
      .min(1)
      .describe("Хеши ранее зафиксированных диалогов (из notarize_dialog)"),
    document_path: z
      .string()
      .optional()
      .describe("Путь к итоговому документу-решению; будет захеширован и зафиксирован"),
    comment: z.string().optional(),
  },
  async (args) => {
    const result = await attestDecision(deps, args)
    return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }] }
  }
)

server.tool(
  "check_hash",
  "Проверить, заякорен ли хеш on-chain (одиночная фиксация). Требует настроенного RPC.",
  {
    hash: z.string().regex(/^0x[0-9a-f]{64}$/).describe("SHA-256 хеш артефакта"),
  },
  async ({ hash }) => {
    if (!chainConfigured) {
      return {
        content: [
          { type: "text", text: "Чейн не сконфигурирован (RPC_URL/NOTARY_ADDRESS/NOTARY_PK)" },
        ],
        isError: true,
      }
    }
    const record = await notaryGetRecord(hash)
    const local = db.getArtifactByHash(hash)
    const queue = db.getAnchorByHash(hash)
    return {
      content: [
        {
          type: "text",
          text: JSON.stringify(
            {
              on_chain: record.exists
                ? { author: record.author, timestamp: record.timestamp }
                : false,
              local_artifact: local?.display_name ?? null,
              queue_status: queue?.status ?? null,
            },
            null,
            2
          ),
        },
      ],
    }
  }
)

// Клиент закрыл stdin — штатное завершение сессии
process.stdin.on("close", () => process.exit(0))

await server.connect(new StdioServerTransport())
log("сервер запущен (stdio)")
