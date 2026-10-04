import type { Fingerprint } from "../plugin/fingerprint"
import type { ManagedAccount } from "../plugin/accounts"

export interface OpenAITool {
  type?: string
  function?: {
    name?: string
    description?: string
    parameters?: unknown
  }
}

export interface OpenAIToolCall {
  readonly id?: string
  readonly type?: string
  readonly function?: {
    readonly name?: string
    readonly arguments?: string
  }
  readonly extra_content?: {
    readonly google?: {
      readonly thought_signature?: string
    }
  }
}

export interface CompletionUsage {
  promptTokens: number
  completionTokens: number
  totalTokens: number
  cachedTokens: number
}

export interface CompletionImage {
  mimeType: string
  data: string
}

export interface OpenAIMessage {
  role?: string
  content?: unknown
  tool_call_id?: string
  name?: string
  readonly tool_calls?: readonly OpenAIToolCall[]
}

export interface ChatRequest {
  model?: string
  messages?: OpenAIMessage[]
  stream?: boolean
  tools?: OpenAITool[]
  tool_choice?: unknown
  max_tokens?: number
  temperature?: number
  user?: string
}

export interface PoolAccount {
  id: string
  refreshToken: string
  accessToken?: string
  expiresAt?: number
  projectId: string
  fingerprint?: Fingerprint
  raw?: ManagedAccount
}

export interface AccountPool {
  acquire(sessionKey: string, model: string): PoolAccount | null
  markLimited(account: PoolAccount, retryAfterMs: number, model: string): void
  unbind(sessionKey: string): void
  markUsed?(account: PoolAccount): void
}

export interface CompletionResult {
  model: string
  text: string
  accountId: string
  toolCalls: Array<{ id: string; name: string; arguments: string; thoughtSignature?: string }>
  usage?: CompletionUsage
  reasoningContent?: string
  reasoningSignature?: string
  finishReason?: "stop" | "tool_calls" | "content_filter" | "length" | "recitation"
  upstreamFinishReason?: string
  safetyMessage?: string
  images?: CompletionImage[]
}
