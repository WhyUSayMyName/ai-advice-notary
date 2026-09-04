import "dotenv/config"
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js"
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js"
import { z } from "zod"
import { createDatabase } from "../main/database-core"
import { notaryGetRecord } from "../main/notary"
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
 *   NOTARY_DB_PATH — путь к базе (по умолчанию общая с desktop-приложением)
 *
 * Ключа подписи здесь нет и не должно быть. Сервер работает только в режиме
 * enqueue-only: канонизирует, считает хеш и кладёт его в очередь. Якорит
 * приложение — оно одно держит ключ в защищённом хранилище ОС. Плата за это
 * — фиксация ждёт запуска приложения; выигрыш — ключ не лежит открытым
 * текстом в конфиге MCP-клиента, который синхронизируется между машинами.
 */

const log = (msg: string) => console.error(`[notary-mcp] ${msg}`)

const dbPath = resolveSharedDbPath()
const db = createDatabase(dbPath)
const artifactsDir = process.env.NOTARY_ARTIFACTS_DIR ?? defaultArtifactsDir(dbPath)

// Чтение реестра ключа не требует — проверить хеш может кто угодно.
const canRead = Boolean(process.env.RPC_URL && process.env.NOTARY_ADDRESS)

const deps: McpDeps = { db, enqueue: (hash) => db.enqueueAnchor(hash), artifactsDir }

log(
  canRead
    ? "режим enqueue-only: хеши копятся в очереди, якорит приложение; проверка хешей доступна"
    : "режим enqueue-only: RPC_URL/NOTARY_ADDRESS не заданы, проверка хешей недоступна"
)
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
  "Проверить, заякорен ли хеш on-chain (одиночная фиксация). Достаточно RPC_URL и NOTARY_ADDRESS — приватный ключ для чтения не нужен.",
  {
    hash: z.string().regex(/^0x[0-9a-f]{64}$/).describe("SHA-256 хеш артефакта"),
  },
  async ({ hash }) => {
    if (!canRead) {
      return {
        content: [
          { type: "text", text: "Чейн не сконфигурирован (нужны RPC_URL и NOTARY_ADDRESS)" },
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
