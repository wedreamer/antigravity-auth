import { prepareAntigravityRequest, transformAntigravityResponse } from "../plugin/request.ts"
import { extractCompletion, geminiUrl, normalizeModel, toGeminiBody } from "./openai.ts"
import { refreshAccessToken } from "./pool.ts"
import type { AccountPool, ChatRequest, CompletionResult, PoolAccount } from "./types.ts"

export interface CompleteDeps {
  fetchImpl?: typeof fetch
  pool: AccountPool
  refresh?: (account: PoolAccount, fetchImpl: typeof fetch) => Promise<string>
  transform?: typeof transformAntigravityResponse
}

export class BridgeError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly errorType: string,
  ) {
    super(message)
    this.name = "BridgeError"
  }
}

export async function completeChat(
  request: ChatRequest,
  sessionKey: string,
  deps: CompleteDeps,
): Promise<CompletionResult> {
  const fetchImpl = deps.fetchImpl ?? fetch
  const refresh = deps.refresh ?? refreshAccessToken
  const transform = deps.transform ?? transformAntigravityResponse
  const model = normalizeModel(request.model)
  const seen = new Set<string>()
  let lastStatus = 429
  let account = deps.pool.acquire(sessionKey, model)

  for (let attempt = 0; attempt < 8 && account; attempt++) {
    if (seen.has(account.id)) break
    seen.add(account.id)
    let accessToken: string
    try {
      accessToken = await refresh(account, fetchImpl)
    } catch (error) {
      const message = error instanceof Error ? error.message : "token refresh failed"
      throw new BridgeError(message, 401, "authentication_error")
    }

    const upstream = await callAccount(request, model, account, accessToken, fetchImpl, false)
    if (upstream.status === 401) {
      account.accessToken = undefined
      account.expiresAt = undefined
      let refreshed: string
      try {
        refreshed = await refresh(account, fetchImpl)
      } catch (error) {
        const message = error instanceof Error ? error.message : "token refresh failed"
        throw new BridgeError(message, 401, "authentication_error")
      }
      const retried = await callAccount(request, model, account, refreshed, fetchImpl, false)
      if (retried.ok) return finish(retried, model, account.id, transform, deps, account)
      lastStatus = retried.status
      deps.pool.unbind(sessionKey)
      account = deps.pool.acquire(sessionKey, model)
      continue
    }
    if (upstream.status === 429) {
      deps.pool.markLimited(account, 60_000, model)
      deps.pool.unbind(sessionKey)
      lastStatus = 429
      account = deps.pool.acquire(sessionKey, model)
      continue
    }
    if (!upstream.ok) {
      throw new BridgeError(await upstreamFailureMessage(upstream), upstream.status, "api_error")
    }
    return finish(upstream, model, account.id, transform, deps, account)
  }

  throw new BridgeError("all gemini accounts are rate limited", lastStatus === 429 ? 429 : 503, "rate_limit_error")
}

const UPSTREAM_DETAIL_LIMIT = 400

function detailFromBody(status: number, body: string): string {
  const prefix = `upstream status ${status}`
  const snippet = body.trim().slice(0, UPSTREAM_DETAIL_LIMIT)
  if (!snippet) return prefix
  let parsed: unknown
  try {
    parsed = JSON.parse(body)
  } catch (error) {
    if (error instanceof SyntaxError) return `${prefix}: ${snippet}`
    throw error
  }
  if (!parsed || typeof parsed !== "object" || !("error" in parsed)) return `${prefix}: ${snippet}`
  const errorField = parsed.error
  if (!errorField || typeof errorField !== "object" || !("message" in errorField)) {
    return `${prefix}: ${snippet}`
  }
  const message = errorField.message
  if (typeof message !== "string" || message.length === 0) return `${prefix}: ${snippet}`
  return `${prefix}: ${message.slice(0, UPSTREAM_DETAIL_LIMIT)}`
}

async function upstreamFailureMessage(response: Response): Promise<string> {
  const prefix = `upstream status ${response.status}`
  let body: string
  try {
    body = await response.text()
  } catch (error) {
    if (error instanceof TypeError) return prefix
    throw error
  }
  return detailFromBody(response.status, body)
}

async function finish(
  response: Response,
  model: string,
  accountId: string,
  transform: typeof transformAntigravityResponse,
  deps: CompleteDeps,
  account: PoolAccount,
): Promise<CompletionResult> {
  deps.pool.markUsed?.(account)
  const completion = await readCompletion(response, model, transform)
  completion.accountId = accountId
  return completion
}

async function callAccount(
  request: ChatRequest,
  model: string,
  account: PoolAccount,
  accessToken: string,
  fetchImpl: typeof fetch,
  stream: boolean,
): Promise<Response> {
  const prepared = prepareAntigravityRequest(
    geminiUrl(model, stream),
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(toGeminiBody(request, model)),
    },
    accessToken,
    account.projectId,
    undefined,
    "antigravity",
    false,
    { fingerprint: account.fingerprint },
  )
  const url = typeof prepared.request === "string" ? prepared.request : prepared.request.url
  return fetchImpl(url, prepared.init)
}

async function readCompletion(
  response: Response,
  model: string,
  transform: typeof transformAntigravityResponse,
): Promise<CompletionResult> {
  const transformed = await transform(response, false)
  const payload = await transformed.json() as unknown
  const completion = extractCompletion(payload, model)
  if (!completion.text && completion.toolCalls.length === 0) {
    throw new BridgeError("upstream returned an empty completion", 502, "api_error")
  }
  return completion
}
