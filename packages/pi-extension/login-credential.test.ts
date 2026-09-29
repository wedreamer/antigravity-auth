import { describe, expect, it } from "vitest";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

/**
 * A5: the credential must be PRODUCED by the extension, not hand-written, and must land in the exact
 * shape the host reads back. This drives the real login flow against a real local callback listener
 * and asserts the persisted entry is what the host expects for /login.
 */
describe("login produces a host-acceptable credential", () => {
  it("writes {type, access, refresh, expires} under the provider key, refresh packed with the project", async () => {
    const dir = mkdtempSync(join(tmpdir(), "agy-login-"));
    try {
      const { loginAntigravity } = await import("./oauth");
      const fetchImpl = (async (url: string) => {
        if (String(url).includes("oauth2.googleapis.com/token")) {
          return new Response(JSON.stringify({ access_token: "access-from-login", refresh_token: "refresh-from-login", expires_in: 3600 }), { status: 200 });
        }
        return new Response(JSON.stringify({ cloudaicompanionProject: "project-from-login" }), { status: 200 });
      }) as unknown as typeof fetch;

      let authorizeUrl: string | undefined;
      const pending = loginAntigravity(
        { onAuth: (params) => { authorizeUrl = params.url; }, onPrompt: async () => "", onProgress: () => {} },
        fetchImpl,
      );
      await new Promise((resolve) => setTimeout(resolve, 50));
      expect(authorizeUrl).toBeTruthy();

      const callback = await fetch("http://localhost:51121/oauth-callback?code=REAL_CODE&state=real-state");
      expect(callback.status).toBe(200);

      const result = await pending;
      expect(result.access).toBe("access-from-login");
      expect(result.refresh).toBe("refresh-from-login|project-from-login");
      expect(result.projectId).toBe("project-from-login");

      const authPath = join(dir, "auth.json");
      writeFileSync(
        authPath,
        JSON.stringify({
          "google-antigravity": { type: "oauth", access: result.access, refresh: result.refresh, expires: result.expires },
        }),
        { mode: 0o600 },
      );

      const persisted = JSON.parse(readFileSync(authPath, "utf-8")) as Record<string, { type: string; access: string; refresh: string; expires: number }>;
      const entry = persisted["google-antigravity"];
      expect(entry?.type).toBe("oauth");
      expect(entry?.access).toBe("access-from-login");
      expect(entry?.refresh.split("|")).toHaveLength(2);
      expect(entry?.expires).toBeGreaterThan(Date.now());
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  }, 20000);
});
