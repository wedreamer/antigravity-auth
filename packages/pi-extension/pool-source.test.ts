import { afterEach, describe, expect, it, vi } from "vitest";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import {
  createRotationState,
  cursorFilePath,
  describeAccount,
  enabledAccountCount,
  enabledPoolAccounts,
  pickNextPoolAccount,
  pickNextPoolAccountPersistent,
  poolAccountToCredentials,
  type PoolSnapshot,
} from "./pool-source";

const dirs: string[] = [];

function snapshotOf(accounts: { refreshToken: string; enabled?: boolean; email?: string; managedProjectId?: string }[], path = "/tmp/pool.json"): PoolSnapshot {
  return { version: 4, activeIndex: 0, accounts, path };
}

function tempDir(): string {
  const dir = mkdtempSync(join(tmpdir(), "agy-pool-"));
  dirs.push(dir);
  return dir;
}

afterEach(() => {
  while (dirs.length > 0) {
    const dir = dirs.pop();
    if (dir) rmSync(dir, { recursive: true, force: true });
  }
});

describe("pool selection", () => {
  it("uses only enabled accounts that carry a refresh token", () => {
    const snapshot = snapshotOf([
      { refreshToken: "enabled-1", enabled: true },
      { refreshToken: "disabled-1", enabled: false },
      { refreshToken: "", enabled: true },
    ]);
    expect(enabledPoolAccounts(snapshot)).toHaveLength(1);
    expect(enabledAccountCount(snapshot)).toBe(1);
  });

  it("treats a missing snapshot as an empty pool", () => {
    expect(enabledPoolAccounts(undefined)).toEqual([]);
    expect(enabledAccountCount(undefined)).toBe(0);
  });

  it("rotates in memory across accounts instead of pinning one", () => {
    const snapshot = snapshotOf([
      { refreshToken: "account-one", enabled: true },
      { refreshToken: "account-two", enabled: true },
      { refreshToken: "account-three", enabled: true },
    ]);
    const state = createRotationState();
    const picked = [0, 1, 2, 3].map(() => pickNextPoolAccount(snapshot, state)?.refreshToken);
    expect(picked[0]).not.toBe(picked[1]);
    expect(picked[1]).not.toBe(picked[2]);
    expect(picked[3]).toBe(picked[0]);
  });

  it("survives an empty pool rather than throwing", () => {
    const state = createRotationState();
    expect(pickNextPoolAccount(snapshotOf([]), state)).toBeUndefined();
  });
});

describe("persisted rotation cursor", () => {
  it("advances across calls and wraps, surviving a fresh process's memory state", () => {
    const cursor = join(tempDir(), "cursor");
    const snapshot = snapshotOf([
      { refreshToken: "cursor-a", enabled: true },
      { refreshToken: "cursor-b", enabled: true },
    ]);
    const first = pickNextPoolAccountPersistent(snapshot, cursor)?.refreshToken;
    const second = pickNextPoolAccountPersistent(snapshot, cursor)?.refreshToken;
    const third = pickNextPoolAccountPersistent(snapshot, cursor)?.refreshToken;
    expect(first).not.toBe(second);
    expect(third).toBe(first);
  });

  it("returns undefined for an empty pool and writes no cursor", () => {
    const cursor = join(tempDir(), "cursor-empty");
    expect(pickNextPoolAccountPersistent(snapshotOf([]), cursor)).toBeUndefined();
  });

  it("derives the cursor path from the pool path", () => {
    expect(cursorFilePath("/tmp/antigravity-accounts.json")).toBe("/tmp/antigravity-accounts.json.cursor");
  });
});

describe("account reporting and credential shaping", () => {
  it("never exposes token or email material in an account label", () => {
    const label = describeAccount({ refreshToken: "super-secret-token-value", email: "someone@example.com", enabled: true });
    expect(label).not.toContain("super-secret-token-value");
    expect(label).not.toContain("someone@example.com");
    expect(label).toContain("token-len-");
  });

  it("packs a pool account into the credential format the refresh flow expects", () => {
    const credentials = poolAccountToCredentials({ refreshToken: "pool-refresh", managedProjectId: "proj-x", enabled: true });
    expect(credentials.refresh).toBe("pool-refresh|proj-x");
  });
});

describe("pool-backed credential resolution", () => {
  it("serves turns from the pool, not from a single auth.json entry", async () => {
    const dir = tempDir();
    const poolFile = join(dir, "antigravity-accounts.json");
    writeFileSync(poolFile, JSON.stringify({ version: 4, activeIndex: 0, accounts: [
      { refreshToken: "pool-token-aaaa", enabled: true },
      { refreshToken: "pool-token-bbbb", enabled: true },
    ] }));
    process.env.ANTIGRAVITY_ACCOUNTS_PATH = poolFile;
    process.env.ANTIGRAVITY_CURSOR_PATH = join(dir, "cursor");
    try {
      const { resolveTurnCredential, resetRotationForTests } = await import("./credential-source");
      resetRotationForTests();
      const refreshCalls: string[] = [];
      const fetchImpl = vi.fn(async (_url: string, init: { body: URLSearchParams }) => {
        refreshCalls.push(String(init.body.get("refresh_token")));
        return new Response(JSON.stringify({ access_token: "access-from-pool", expires_in: 3600 }), { status: 200 });
      });

      const first = await resolveTurnCredential("antigravity-gemini-3.8-flash", fetchImpl as unknown as typeof fetch);
      const second = await resolveTurnCredential("antigravity-gemini-3.8-flash", fetchImpl as unknown as typeof fetch);

      expect(first.accessToken).toBe("access-from-pool");
      expect(refreshCalls[0]).not.toBe(refreshCalls[1]);
      expect(new Set(refreshCalls).size).toBe(2);
      expect(first.account).toContain("token-len-");
    } finally {
      delete process.env.ANTIGRAVITY_ACCOUNTS_PATH;
      delete process.env.ANTIGRAVITY_CURSOR_PATH;
    }
  });

  it("falls through to the next account when one is refused", async () => {
    const dir = tempDir();
    const poolFile = join(dir, "antigravity-accounts.json");
    writeFileSync(poolFile, JSON.stringify({ version: 4, activeIndex: 0, accounts: [
      { refreshToken: "refused-account", enabled: true },
      { refreshToken: "healthy-account", enabled: true },
    ] }));
    process.env.ANTIGRAVITY_ACCOUNTS_PATH = poolFile;
    process.env.ANTIGRAVITY_CURSOR_PATH = join(dir, "cursor-refused");
    try {
      const { resolveTurnCredential, resetRotationForTests } = await import("./credential-source");
      resetRotationForTests();
      const tried: string[] = [];
      const fetchImpl = vi.fn(async (_url: string, init: { body: URLSearchParams }) => {
        const token = String(init.body.get("refresh_token"));
        tried.push(token);
        if (token === "refused-account") {
          return new Response(JSON.stringify({ error: "invalid_grant" }), { status: 400 });
        }
        return new Response(JSON.stringify({ access_token: "access-from-healthy", expires_in: 3600 }), { status: 200 });
      });

      const resolved = await resolveTurnCredential("antigravity-gemini-3.8-flash", fetchImpl as unknown as typeof fetch);
      expect(tried).toContain("refused-account");
      expect(tried).toContain("healthy-account");
      expect(resolved.accessToken).toBe("access-from-healthy");
    } finally {
      delete process.env.ANTIGRAVITY_ACCOUNTS_PATH;
      delete process.env.ANTIGRAVITY_CURSOR_PATH;
    }
  });

  it("surfaces the failure when every account is refused", async () => {
    const dir = tempDir();
    const poolFile = join(dir, "antigravity-accounts.json");
    writeFileSync(poolFile, JSON.stringify({ version: 4, activeIndex: 0, accounts: [
      { refreshToken: "refused-one", enabled: true },
      { refreshToken: "refused-two", enabled: true },
    ] }));
    process.env.ANTIGRAVITY_ACCOUNTS_PATH = poolFile;
    process.env.ANTIGRAVITY_CURSOR_PATH = join(dir, "cursor-all-refused");
    try {
      const { resolveTurnCredential, resetRotationForTests } = await import("./credential-source");
      resetRotationForTests();
      const fetchImpl = vi.fn(async () => new Response(JSON.stringify({ error: "invalid_grant" }), { status: 400 }));
      await expect(resolveTurnCredential("antigravity-gemini-3.8-flash", fetchImpl as unknown as typeof fetch)).rejects.toThrow();
    } finally {
      delete process.env.ANTIGRAVITY_ACCOUNTS_PATH;
      delete process.env.ANTIGRAVITY_CURSOR_PATH;
    }
  });

  it("falls back to the auth.json credential when no pool file exists", async () => {
    const dir = tempDir();
    process.env.ANTIGRAVITY_ACCOUNTS_PATH = join(dir, "absent.json");
    process.env.SENPI_CODING_AGENT_DIR = dir;
    writeFileSync(join(dir, "auth.json"), JSON.stringify({ "google-antigravity": { refresh: "single-rt|proj" } }));
    try {
      const { resolveTurnCredential, resetRotationForTests } = await import("./credential-source");
      resetRotationForTests();
      const tokens: string[] = [];
      const fetchImpl = vi.fn(async (_url: string, init: { body: URLSearchParams }) => {
        tokens.push(String(init.body.get("refresh_token")));
        return new Response(JSON.stringify({ access_token: "access-from-authjson", expires_in: 3600 }), { status: 200 });
      });
      const resolved = await resolveTurnCredential("antigravity-gemini-3.8-flash", fetchImpl as unknown as typeof fetch);
      expect(tokens[0]).toBe("single-rt");
      expect(resolved.account).toBe("auth.json");
    } finally {
      delete process.env.ANTIGRAVITY_ACCOUNTS_PATH;
      delete process.env.SENPI_CODING_AGENT_DIR;
    }
  });
});
