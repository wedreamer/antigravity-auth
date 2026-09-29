import {
  addJitter,
  randomDelay,
  selectHybridAccount,
  sortByLruWithHealth,
  HealthScoreTracker,
  TokenBucketTracker,
  type AccountWithMetrics,
} from "../plugin/rotation";
import {
  calculateBackoffMs,
  parseRateLimitReason,
  computeSoftQuotaCacheTtlMs,
  resolveQuotaGroup,
  type RateLimitBackoffResult,
  type RateLimitReason,
} from "../plugin/accounts";
import { loadAccounts, saveAccounts, getStoragePath } from "../plugin/storage";
import type { AccountStorageV4 } from "../plugin/storage";

/**
 * Pool layer seam. The Antigravity pool lives in `antigravity-accounts.json` and both hosts read
 * the same file: OpenCode through the plugin's AccountManager, and the pi extension through these
 * primitives. Keeping one implementation is what stops a login or a quota verdict on one host from
 * disagreeing with the other.
 */
export interface SharedPoolAccount {
  email?: string;
  refreshToken: string;
  enabled?: boolean;
  managedProjectId?: string;
}

export interface SharedPoolSnapshot {
  version: number;
  activeIndex: number;
  accounts: SharedPoolAccount[];
  path?: string;
}

export function selectableAccounts(accounts: readonly SharedPoolAccount[]): SharedPoolAccount[] {
  return accounts.filter((account) => account.enabled === true && Boolean(account.refreshToken));
}

export async function readPool(): Promise<SharedPoolSnapshot | undefined> {
  return readPoolFromFile(getStoragePath());
}

/**
 * Reads a pool snapshot from an explicit path. The plugin reads its own storage location; the native
 * extension points this at the same file so a pool migrated from OpenCode actually serves the other
 * host, and tests can drive a fixture instead of the machine's real accounts.
 */
export async function readPoolFromFile(path: string): Promise<SharedPoolSnapshot | undefined> {
  try {
    const { readFile } = await import("node:fs/promises");
    const raw = await readFile(path, "utf-8");
    const parsed = JSON.parse(raw) as { version?: number; activeIndex?: number; accounts?: SharedPoolAccount[] };
    const accounts = Array.isArray(parsed.accounts) ? parsed.accounts : [];
    return {
      version: typeof parsed.version === "number" ? parsed.version : 0,
      activeIndex: typeof parsed.activeIndex === "number" ? parsed.activeIndex : 0,
      accounts: accounts.map((account) => ({
        email: account.email,
        refreshToken: account.refreshToken,
        enabled: account.enabled,
        managedProjectId: account.managedProjectId,
      })),
      path,
    };
  } catch {
    return undefined;
  }
}

export {
  addJitter,
  randomDelay,
  selectHybridAccount,
  sortByLruWithHealth,
  HealthScoreTracker,
  TokenBucketTracker,
  calculateBackoffMs,
  parseRateLimitReason,
  computeSoftQuotaCacheTtlMs,
  resolveQuotaGroup,
};
export type { AccountWithMetrics, RateLimitBackoffResult, RateLimitReason };
