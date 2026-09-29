import { appendFileSync } from "node:fs";
import { readStoredRefresh } from "./index.ts";
import { refreshAntigravity } from "./oauth.ts";
import {
  createRotationState,
  describeAccount,
  enabledAccountCount,
  loadPoolSnapshot,
  pickNextPoolAccountPersistent,
  poolAccountToCredentials,
  poolFilePath,
  type PoolSnapshot,
} from "./pool-source.ts";
import type { ResolvedTurnCredential } from "./stream.ts";

export interface CredentialResolution {
  accessToken: string;
  storedRefresh: string;
  account: string;
}
const rotation = createRotationState();
/**
 * Records which pool account served a turn, never the credential itself, so a run can be audited for
 * real rotation (two turns, two accounts) without any secret leaving the machine. Set
 * ANTIGRAVITY_SERVED_LOG to a path to enable it; unset means the hook does nothing.
 */
function recordServedAccount(account: string): void {
  const target = process.env.ANTIGRAVITY_SERVED_LOG;
  if (!target) return;
  try {
    appendFileSync(target, `${account}\n`);
  } catch {
    /* an audit log must never break a turn */
  }
}
let cachedPool: { snapshot: PoolSnapshot | undefined; readAt: number } | undefined;
const POOL_CACHE_MS = 5_000;

function poolSnapshot(): Promise<PoolSnapshot | undefined> {
  const now = Date.now();
  if (cachedPool && now - cachedPool.readAt < POOL_CACHE_MS) return Promise.resolve(cachedPool.snapshot);
  return loadPoolSnapshot().then((snapshot) => {
    cachedPool = { snapshot, readAt: now };
    return snapshot;
  });
}

/**
 * Resolves the credential one turn should use. The Antigravity pool is preferred so a pool migrated
 * from OpenCode actually serves the native runtime; the single `auth.json` credential is the
 * fallback for a machine that only ever ran `/login`. Rotation advances per turn, and a refused
 * account is skipped in favour of the next pool member rather than failing the turn.
 */
export async function resolveTurnCredential(modelId: string, fetchImpl: typeof fetch = fetch): Promise<CredentialResolution> {
  const snapshot = await poolSnapshot();
  const attempts = enabledAccountCount(snapshot);
  let lastError: unknown;
  for (let attempt = 0; attempt < Math.max(attempts, 1); attempt += 1) {
    const account = pickNextPoolAccountPersistent(snapshot);
    if (!account) break;
    const credentials = poolAccountToCredentials(account);
    try {
      const refreshed = await refreshAntigravity(credentials, undefined, fetchImpl);
      recordServedAccount(describeAccount(account));
      return {
        accessToken: refreshed.access,
        storedRefresh: refreshed.refresh,
        account: describeAccount(account),
      };
    } catch (error) {
      lastError = error;
    }
  }
  if (lastError && attempts > 0) {
    throw lastError;
  }

  const single = readStoredRefresh();
  const refreshed = await refreshAntigravity({ refresh: single, access: "", expires: 0 }, undefined, fetchImpl);
  return { accessToken: refreshed.access, storedRefresh: refreshed.refresh, account: "auth.json" };
}

export async function poolStatus(): Promise<{ path: string; enabled: number; total: number }> {
  const snapshot = await poolSnapshot();
  return {
    path: poolFilePath(),
    enabled: snapshot ? snapshot.accounts.filter((account) => account.enabled === true && account.refreshToken).length : 0,
    total: snapshot?.accounts.length ?? 0,
  };
}

export function resetRotationForTests(): void {
  rotation.nextIndex = 0;
  cachedPool = undefined;
}
