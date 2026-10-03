import type { Fingerprint } from "../plugin/fingerprint.ts"
import type { ManagedAccount } from "../plugin/accounts.ts"

export interface OpenAITool {
  type?: string
  function?: {
    name?: string
    description?: string
    parameters?: unknown
  }
}

export interface OpenAIMessage {
  role?: string
  content?: unknown
  tool_call_id?: string
  name?: string
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
  toolCalls: Array<{ id: string; name: string; arguments: string }>
}
