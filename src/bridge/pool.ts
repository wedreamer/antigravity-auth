import { existsSync } from "node:fs"
import { dirname } from "node:path"

import { ANTIGRAVITY_CLIENT_ID, ANTIGRAVITY_CLIENT_SECRET, ANTIGRAVITY_DEFAULT_PROJECT_ID } from "../constants.ts"
import { AccountManager, type ManagedAccount } from "../plugin/accounts.ts"
import { clearStickyBinding, createStickyState, pickStickyAccount } from "./affinity.ts"
import type { AccountPool, PoolAccount } from "./types.ts"

const REFRESH_SKEW_MS = 60_000

export async function loadAccountPool(accountsPath: string): Promise<AccountPool> {
  if (!existsSync(accountsPath)) {
    throw new Error("accounts file not found")
  }
  process.env.OPENCODE_CONFIG_DIR = dirname(accountsPath)
  const manager = await AccountManager.loadFromDisk()
  const sticky = createStickyState()
  return {
    acquire(sessionKey) {
      const available = manager.getEnabledAccounts()
        .filter((account) => !accountUnavailable(account))
        .map(toPoolAccount)
      return pickStickyAccount(sticky, sessionKey, available)
    },
    markLimited(account, retryAfterMs, model) {
      if (!account.raw) return
      manager.markRateLimited(account.raw, retryAfterMs, "gemini", "antigravity", model)
    },
    unbind(sessionKey) {
      clearStickyBinding(sticky, sessionKey)
    },
    markUsed(account) {
      const index = Number(account.id)
      if (Number.isInteger(index)) manager.markAccountUsed(index)
    },
  }
}

function toPoolAccount(account: ManagedAccount): PoolAccount {
  return {
    id: String(account.index),
    refreshToken: account.parts.refreshToken,
    accessToken: account.access,
    expiresAt: account.expires,
    projectId: account.parts.managedProjectId || account.parts.projectId || ANTIGRAVITY_DEFAULT_PROJECT_ID,
    fingerprint: account.fingerprint,
    raw: account,
  }
}

function accountUnavailable(account: ManagedAccount, now = Date.now()): boolean {
  if (account.enabled === false) return true
  if (typeof account.coolingDownUntil === "number" && account.coolingDownUntil > now) return true
  for (const resetAt of Object.values(account.rateLimitResetTimes)) {
    if (typeof resetAt === "number" && resetAt > now) return true
  }
  return false
}

export async function refreshAccessToken(account: PoolAccount, fetchImpl: typeof fetch): Promise<string> {
  if (account.accessToken && account.expiresAt && account.expiresAt - REFRESH_SKEW_MS > Date.now()) {
    return account.accessToken
  }
  if (!account.refreshToken) {
    throw new Error("account is missing a refresh token")
  }
  const response = await fetchImpl("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "refresh_token",
      refresh_token: account.refreshToken,
      client_id: ANTIGRAVITY_CLIENT_ID,
      client_secret: ANTIGRAVITY_CLIENT_SECRET,
    }),
  })
  if (!response.ok) {
    throw new Error(`token refresh failed with status ${response.status}`)
  }
  const payload = await response.json() as { access_token?: unknown; expires_in?: unknown }
  if (typeof payload.access_token !== "string" || payload.access_token.length === 0) {
    throw new Error("token refresh returned no access token")
  }
  const expiresIn = typeof payload.expires_in === "number" ? payload.expires_in : 3600
  account.accessToken = payload.access_token
  account.expiresAt = Date.now() + expiresIn * 1000
  if (account.raw) {
    account.raw.access = payload.access_token
    account.raw.expires = account.expiresAt
  }
  return payload.access_token
}
