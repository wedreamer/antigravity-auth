import { describe, expect, it, vi } from "vitest";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { PROVIDER_API_ID, PROVIDER_ID, registerAntigravityProvider } from "./index";

interface CapturedConfig {
  api: string;
  models: unknown[];
  streamSimple: (
    model: { id: string },
    context: { messages?: unknown[]; systemPrompt?: string },
    options: { apiKey: string },
  ) => { events: Record<string, unknown>[] };
}

function registerWithFakeHost() {
  let captured: CapturedConfig | undefined;
  registerAntigravityProvider({
    registerProvider: (_id, config) => {
      captured = config as unknown as CapturedConfig;
    },
  });
  if (!captured) throw new Error("provider was not registered");
  return captured;
}
describe("provider registration contract", () => {
  it("registers under the provider id the docs and C5 use", () => {
    const config = registerWithFakeHost();
    expect(PROVIDER_ID).toBe("google-antigravity");
    expect(PROVIDER_API_ID).toBe("antigravity-code-assist");
    expect(config.api).toBe(PROVIDER_API_ID);
    expect(config.models.length).toBeGreaterThan(0);
  });

  it("carries the host systemPrompt into the request the stream builds", async () => {
    const dir = mkdtempSync(join(tmpdir(), "agy-reg-"));
    const poolFile = join(dir, "antigravity-accounts.json");
    writeFileSync(poolFile, JSON.stringify({ version: 4, activeIndex: 0, accounts: [{ refreshToken: "pool-rt", enabled: true }] }));
    process.env.ANTIGRAVITY_ACCOUNTS_PATH = poolFile;
    vi.stubGlobal("fetch", undefined as never);
    try {
      const config = registerWithFakeHost();
      const captured: Record<string, unknown>[] = [];
      const refreshed: string[] = [];
      const fetchImpl = vi.fn(async (url: string, init: { body: string }) => {
        if (String(url).includes("oauth2.googleapis.com/token")) {
          refreshed.push(String(init.body));
          return new Response(JSON.stringify({ access_token: "pooled-access", expires_in: 3600 }), { status: 200 });
        }
        captured.push(JSON.parse(init.body) as Record<string, unknown>);
        return new Response("data: " + JSON.stringify({ response: { candidates: [{ content: { parts: [{ text: "ok" }] } }] } }) + "\n\n", { status: 200 });
      });
      vi.stubGlobal("fetch", fetchImpl);
      try {
        const stream = config.streamSimple(
          { id: "antigravity-gemini-3.8-flash" },
          { messages: [{ role: "user", content: "hi" }], systemPrompt: "HOST_RULES_MARKER" },
          { apiKey: "token" },
        );
        await vi.waitFor(() => expect(captured.length).toBeGreaterThan(0));
        const request = captured[0]?.request as { systemInstruction?: { parts: { text: string }[] } };
        const text = request.systemInstruction?.parts[0]?.text ?? "";
        expect(text).toContain("HOST_RULES_MARKER");
        expect(text).toContain("Antigravity");
        expect(captured[0]?.model).toBe("gemini-3.8-flash-low");
        void stream;
      } finally {
        vi.unstubAllGlobals();
      }
    } finally {
      delete process.env.ANTIGRAVITY_ACCOUNTS_PATH;
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("never sends the header set the backend rejects in antigravity mode", async () => {
    const dir = mkdtempSync(join(tmpdir(), "agy-reg-"));
    writeFileSync(join(dir, "antigravity-accounts.json"), JSON.stringify({ version: 4, activeIndex: 0, accounts: [{ refreshToken: "pool-rt", enabled: true }] }));
    process.env.ANTIGRAVITY_ACCOUNTS_PATH = join(dir, "antigravity-accounts.json");
    try {
      const config = registerWithFakeHost();
      const headers: Record<string, string> = {};
      const fetchImpl = vi.fn(async (url: string, init: { headers: Record<string, string> }) => {
        if (String(url).includes("oauth2.googleapis.com/token")) {
          return new Response(JSON.stringify({ access_token: "pooled-access", expires_in: 3600 }), { status: 200 });
        }
        Object.assign(headers, init.headers);
        return new Response("data: " + JSON.stringify({ response: { candidates: [{ content: { parts: [{ text: "ok" }] } }] } }) + "\n\n", { status: 200 });
      });
      vi.stubGlobal("fetch", fetchImpl);
      try {
        config.streamSimple({ id: "antigravity-gemini-3.8-flash" }, { messages: [], systemPrompt: "" }, { apiKey: "token" });
        await vi.waitFor(() => expect(Object.keys(headers).length).toBeGreaterThan(0));
        const lower = Object.keys(headers).map((key) => key.toLowerCase());
        expect(lower).not.toContain("client-metadata");
        expect(lower).not.toContain("x-goog-api-client");
        expect(String(headers["User-Agent"])).toContain("antigravity/cli/");
      } finally {
        vi.unstubAllGlobals();
      }
    } finally {
      delete process.env.ANTIGRAVITY_ACCOUNTS_PATH;
      rmSync(dir, { recursive: true, force: true });
    }
  });
});