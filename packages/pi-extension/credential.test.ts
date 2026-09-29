import { afterEach, describe, expect, it } from "vitest";
import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { AntigravityCredentialError, readStoredRefresh } from "./index";

const dirs: string[] = [];

function authFile(content: string | undefined): string {
  const dir = mkdtempSync(join(tmpdir(), "agy-auth-"));
  dirs.push(dir);
  const file = join(dir, "auth.json");
  if (content !== undefined) writeFileSync(file, content);
  return file;
}

afterEach(() => {
  while (dirs.length > 0) {
    const dir = dirs.pop();
    if (dir) rmSync(dir, { recursive: true, force: true });
  }
});

describe("stored credential loading", () => {
  it("returns the stored refresh string", () => {
    expect(readStoredRefresh(authFile(JSON.stringify({ "google-antigravity": { refresh: "rt|proj" } })))).toBe("rt|proj");
  });

  it("raises a typed error when the auth file is missing", () => {
    expect(() => readStoredRefresh(authFile(undefined))).toThrow(AntigravityCredentialError);
    try { readStoredRefresh(authFile(undefined)); } catch (error) {
      expect((error as AntigravityCredentialError).code).toBe("missing-credential");
    }
  });

  it("raises a typed error on malformed JSON instead of silently logging out", () => {
    let caught: unknown;
    try { readStoredRefresh(authFile("{not json")); } catch (error) { caught = error; }
    expect(caught).toBeInstanceOf(AntigravityCredentialError);
    expect((caught as AntigravityCredentialError).code).toBe("malformed-credential");
  });

  it("raises a typed error when the provider entry carries no refresh token", () => {
    let caught: unknown;
    try { readStoredRefresh(authFile(JSON.stringify({ "google-antigravity": {} }))); } catch (error) { caught = error; }
    expect((caught as AntigravityCredentialError).code).toBe("missing-refresh-token");
  });
});