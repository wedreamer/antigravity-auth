import { readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import {
  readPoolFromFile,
  selectableAccounts,
  writeSharedRefresh,
  type SharedPoolAccount,
  type SharedPoolSnapshot,
} from "../../src/shared/index.ts";
import type { AntigravityCredentials } from "./oauth.ts";

export type PoolAccount = SharedPoolAccount;
export type PoolSnapshot = SharedPoolSnapshot;

/**
 * The OpenCode plugin keeps its Antigravity accounts in antigravity-accounts.json. Reading that same
 * file is what lets a pool migrated from OpenCode actually serve the native runtime: without it the
 * extension authenticates with a single hand-written credential and silently ignores every other
 * account the user has. Reading goes through the shared seam so both hosts agree on the file.
 */
export function poolFilePath(): string {
  const xdg = process.env.XDG_CONFIG_HOME || join(homedir(), ".config");
  return process.env.ANTIGRAVITY_ACCOUNTS_PATH ?? join(xdg, "opencode", "antigravity-accounts.json");
}

export async function loadPoolSnapshot(): Promise<PoolSnapshot | undefined> {
  return readPoolFromFile(poolFilePath());
}

export async function readPoolSync(): Promise<PoolSnapshot | undefined> {
  return loadPoolSnapshot();
}

export function enabledPoolAccounts(snapshot: PoolSnapshot | undefined): PoolAccount[] {
  if (!snapshot) return [];
  return selectableAccounts(snapshot.accounts);
}

export function enabledAccountCount(snapshot: PoolSnapshot | undefined): number {
  return enabledPoolAccounts(snapshot).length;
}

export interface PoolRotationState {
  nextIndex: number;
  servingAccount: string;
}

export function createRotationState(): PoolRotationState {
  return { nextIndex: 0, servingAccount: "none" };
}

/**
 * The rotation cursor is persisted next to the pool rather than held in memory: each `omo -p` turn is
 * a separate process, so an in-memory counter would reset to the first account on every turn and the
 * pool would never actually rotate.
 */
export function cursorFilePath(poolPath = poolFilePath()): string {
  return process.env.ANTIGRAVITY_CURSOR_PATH ?? `${poolPath}.cursor`;
}

function readCursor(cursorPath: string): number {
  try {
    const value = Number.parseInt(readFileSync(cursorPath, "utf-8").trim(), 10);
    return Number.isFinite(value) && value >= 0 ? value : 0;
  } catch {
    return 0;
  }
}

function writeCursor(cursorPath: string, value: number): void {
  try {
    writeFileSync(cursorPath, `${value}\n`, { mode: 0o600 });
  } catch {
    /* a rotation hint must never break a turn */
  }
}

export function pickNextPoolAccount(snapshot: PoolSnapshot | undefined, state: PoolRotationState): PoolAccount | undefined {
  const accounts = enabledPoolAccounts(snapshot);
  if (accounts.length === 0) return undefined;
  const account = accounts[state.nextIndex % accounts.length];
  state.nextIndex = (state.nextIndex + 1) % accounts.length;
  state.servingAccount = describeAccount(account);
  return account;
}

export function pickNextPoolAccountPersistent(
  snapshot: PoolSnapshot | undefined,
  cursorPath = cursorFilePath(),
): PoolAccount | undefined {
  const accounts = enabledPoolAccounts(snapshot);
  if (accounts.length === 0) return undefined;
  const index = readCursor(cursorPath) % accounts.length;
  writeCursor(cursorPath, (index + 1) % accounts.length);
  return accounts[index];
}

/**
 * Never returns credential material: an account is reported by a stable label and the length of its
 * token, so logs and test output can be shared without leaking a secret.
 */
export function describeAccount(account: PoolAccount | undefined): string {
  if (!account) return "none";
  const label = account.email ? `email-len-${account.email.length}` : "email-absent";
  return `${label}/token-len-${account.refreshToken.length}`;
}

export function poolAccountToCredentials(account: PoolAccount): AntigravityCredentials {
  const projectId = account.managedProjectId ?? "";
  return {
    refresh: writeSharedRefresh({ refreshToken: account.refreshToken, projectId: projectId || undefined }),
    access: "",
    expires: 0,
  };
}
