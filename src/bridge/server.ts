import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http"

import { BridgeError, completeChat, type CompleteDeps } from "./complete.ts"
import { BRIDGE_MODELS, openAIChunk, openAICompletion } from "./openai.ts"
import type { ChatRequest } from "./types.ts"

export interface ListenOptions {
  port: number
  host?: string
  token?: string
  proxyEnabled?: boolean
  deps: CompleteDeps
}

export interface ListeningBridge {
  port: number
  close: () => Promise<void>
}

export async function listenBridge(options: ListenOptions): Promise<ListeningBridge> {
  const server = createServer((req, res) => {
    void handleRequest(req, res, options).catch(() => {
      if (!res.headersSent) {
        sendJson(res, 500, { error: { message: "bridge failed", type: "api_error" } })
      } else {
        res.end()
      }
    })
  })
  await new Promise<void>((resolve, reject) => {
    server.once("error", reject)
    server.listen(options.port, options.host ?? "127.0.0.1", () => {
      server.off("error", reject)
      resolve()
    })
  })
  const address = server.address()
  const port = address && typeof address === "object" ? address.port : options.port
  return { port, close: () => closeServer(server) }
}

export async function handleRequest(
  req: IncomingMessage,
  res: ServerResponse,
  options: ListenOptions,
): Promise<void> {
  const url = new URL(req.url ?? "/", "http://127.0.0.1")
  if (req.method === "GET" && (url.pathname === "/health" || url.pathname === "/v1/health")) {
    sendJson(res, 200, { ok: true, proxy: options.proxyEnabled === true })
    return
  }
  if (req.method === "GET" && url.pathname === "/v1/models") {
    sendJson(res, 200, {
      object: "list",
      data: BRIDGE_MODELS.map((id) => ({ id, object: "model", owned_by: "antigravity" })),
    })
    return
  }
  if (req.method !== "POST" || url.pathname !== "/v1/chat/completions") {
    sendJson(res, 404, { error: { message: "not found", type: "invalid_request_error" } })
    return
  }
  if (!bearerMatches(req.headers.authorization, options.token ?? "local")) {
    sendJson(res, 401, { error: { message: "invalid bearer token", type: "authentication_error" } })
    return
  }

  let body: ChatRequest
  try {
    body = await readJson(req) as ChatRequest
  } catch {
    sendJson(res, 400, { error: { message: "invalid json", type: "invalid_request_error" } })
    return
  }

  try {
    const completion = await completeChat(body, sessionKeyFrom(req, body), options.deps)
    res.setHeader("x-antigravity-account", completion.accountId)
    if (body.stream) {
      res.writeHead(200, {
        "Content-Type": "text/event-stream",
        "Cache-Control": "no-cache",
        Connection: "keep-alive",
        "x-antigravity-account": completion.accountId,
      })
      res.write(`data: ${JSON.stringify(openAIChunk(completion, false))}\n\n`)
      res.write(`data: ${JSON.stringify(openAIChunk(completion, true))}\n\n`)
      res.write("data: [DONE]\n\n")
      res.end()
      return
    }
    sendJson(res, 200, openAICompletion(completion))
  } catch (error) {
    if (error instanceof BridgeError) {
      sendJson(res, error.status, { error: { message: error.message, type: error.errorType } })
      return
    }
    sendJson(res, 500, { error: { message: "bridge failed", type: "api_error" } })
  }
}

async function readJson(req: IncomingMessage): Promise<unknown> {
  const chunks: Buffer[] = []
  for await (const chunk of req) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk))
  }
  const raw = Buffer.concat(chunks).toString("utf8")
  if (!raw) return {}
  return JSON.parse(raw) as unknown
}

function sendJson(res: ServerResponse, status: number, body: unknown): void {
  const payload = JSON.stringify(body)
  res.writeHead(status, {
    "Content-Type": "application/json",
    "Content-Length": Buffer.byteLength(payload),
  })
  res.end(payload)
}

function bearerMatches(authorization: string | undefined, token: string): boolean {
  if (!authorization) return false
  const match = /^Bearer\s+(\S+)$/i.exec(authorization)
  return match?.[1] === token
}

function sessionKeyFrom(req: IncomingMessage, body: ChatRequest): string {
  const header = req.headers["x-session-id"]
  if (typeof header === "string" && header.trim()) return header.trim()
  if (typeof body.user === "string" && body.user.trim()) return body.user.trim()
  return "default"
}

function closeServer(server: Server): Promise<void> {
  return new Promise((resolve, reject) => {
    server.close((error) => {
      if (error) reject(error)
      else resolve()
    })
  })
}
