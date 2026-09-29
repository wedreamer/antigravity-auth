import { describe, expect, it, vi } from "vitest";
import { buildAuthorizeUrl, exchangeCodeForTokens, loginAntigravity, refreshAccessToken, resolveProjectId } from "./oauth";

const CLIENT_ID = "test-client-id.apps.googleusercontent.com";
const CLIENT_SECRET = "test-client-secret";

describe("authorize URL", () => {
  it("carries every parameter Google requires, including PKCE S256 and offline access", () => {
    const url = new URL(buildAuthorizeUrl("CHALLENGE_VALUE", "STATE_VALUE", CLIENT_ID));
    expect(url.origin + url.pathname).toBe("https://accounts.google.com/o/oauth2/v2/auth");
    expect(url.searchParams.get("client_id")).toBe(CLIENT_ID);
    expect(url.searchParams.get("response_type")).toBe("code");
    expect(url.searchParams.get("code_challenge")).toBe("CHALLENGE_VALUE");
    expect(url.searchParams.get("code_challenge_method")).toBe("S256");
    expect(url.searchParams.get("state")).toBe("STATE_VALUE");
    expect(url.searchParams.get("access_type")).toBe("offline");
    expect(url.searchParams.get("prompt")).toBe("consent");
    expect(url.searchParams.get("redirect_uri")).toContain("oauth-callback");
    expect(url.searchParams.get("scope")).toContain("cloud-platform");
  });
});

describe("token exchange", () => {
  it("posts the authorization_code grant with the verifier and both client values", async () => {
    const fetchImpl = vi.fn(async () => new Response(JSON.stringify({ access_token: "at", refresh_token: "rt", expires_in: 3600 }), { status: 200 }));
    const tokens = await exchangeCodeForTokens({
      code: "AUTH_CODE",
      verifier: "VERIFIER",
      clientId: CLIENT_ID,
      clientSecret: CLIENT_SECRET,
      fetchImpl: fetchImpl as unknown as typeof fetch,
    });
    expect(tokens.access_token).toBe("at");

    const [url, init] = fetchImpl.mock.calls[0] as unknown as [string, { body: URLSearchParams; method: string }];
    expect(url).toBe("https://oauth2.googleapis.com/token");
    expect(init.method).toBe("POST");
    expect(init.body.get("grant_type")).toBe("authorization_code");
    expect(init.body.get("code")).toBe("AUTH_CODE");
    expect(init.body.get("code_verifier")).toBe("VERIFIER");
    expect(init.body.get("client_id")).toBe(CLIENT_ID);
    expect(init.body.get("client_secret")).toBe(CLIENT_SECRET);
  });

  it("surfaces the backend status instead of returning a half-built credential", async () => {
    const fetchImpl = vi.fn(async () => new Response("bad code", { status: 400 }));
    await expect(
      exchangeCodeForTokens({ code: "c", verifier: "v", clientId: CLIENT_ID, clientSecret: CLIENT_SECRET, fetchImpl: fetchImpl as unknown as typeof fetch }),
    ).rejects.toThrow(/Antigravity token exchange failed: 400/);
  });
});

describe("refresh grant", () => {
  it("posts the refresh_token grant with the client values", async () => {
    const fetchImpl = vi.fn(async () => new Response(JSON.stringify({ access_token: "new-at", expires_in: 3599 }), { status: 200 }));
    const tokens = await refreshAccessToken({
      refreshToken: "STORED_RT",
      clientId: CLIENT_ID,
      clientSecret: CLIENT_SECRET,
      fetchImpl: fetchImpl as unknown as typeof fetch,
    });
    expect(tokens.expires_in).toBe(3599);

    const [url, init] = fetchImpl.mock.calls[0] as unknown as [string, { body: URLSearchParams }];
    expect(url).toBe("https://oauth2.googleapis.com/token");
    expect(init.body.get("grant_type")).toBe("refresh_token");
    expect(init.body.get("refresh_token")).toBe("STORED_RT");
    expect(init.body.get("client_id")).toBe(CLIENT_ID);
    expect(init.body.get("client_secret")).toBe(CLIENT_SECRET);
  });
});

describe("project discovery", () => {
  it("reads a string cloudaicompanionProject off loadCodeAssist", async () => {
    const fetchImpl = vi.fn(async () => new Response(JSON.stringify({ cloudaicompanionProject: "proj-a" }), { status: 200 }));
    expect(await resolveProjectId("at", fetchImpl as unknown as typeof fetch)).toBe("proj-a");
  });

  it("reads the nested id form and sends the metadata body the backend accepts", async () => {
    const fetchImpl = vi.fn(async () => new Response(JSON.stringify({ cloudaicompanionProject: { id: "proj-b" } }), { status: 200 }));
    expect(await resolveProjectId("at", fetchImpl as unknown as typeof fetch)).toBe("proj-b");

    const [, init] = fetchImpl.mock.calls[0] as unknown as [string, { body: string }];
    const body = JSON.parse(init.body) as { metadata: { platform: string; ideType: string } };
    expect(body.metadata.platform).toBe("PLATFORM_UNSPECIFIED");
    expect(body.metadata.ideType).toBe("ANTIGRAVITY");
  });

  it("returns empty rather than throwing when the backend refuses", async () => {
    const fetchImpl = vi.fn(async () => new Response("nope", { status: 403 }));
    expect(await resolveProjectId("at", fetchImpl as unknown as typeof fetch)).toBe("");
  });
});

describe("login flow", () => {
  it("completes the whole flow and stores a packed refresh string", async () => {
    const fetchImpl = vi.fn(async (url: string) => {
      if (url.includes("oauth2.googleapis.com/token")) {
        return new Response(JSON.stringify({ access_token: "at", refresh_token: "rt", expires_in: 3600 }), { status: 200 });
      }
      return new Response(JSON.stringify({ cloudaicompanionProject: "proj-login" }), { status: 200 });
    });
    const onAuth = vi.fn();
    // The callback server is real; the login completes as soon as the flow asks for the URL, so the
    // test supplies the code through the same listener the browser would reach.
    const pending = loginAntigravity(
      { onAuth, onPrompt: async () => "", onProgress: () => {} },
      fetchImpl as unknown as typeof fetch,
    );
    await vi.waitFor(() => expect(onAuth).toHaveBeenCalled());
    const authorize = new URL(onAuth.mock.calls[0][0].url);
    const state = authorize.searchParams.get("state") ?? "";
    const response = await fetch(`http://localhost:51121/oauth-callback?code=AUTH_CODE&state=${encodeURIComponent(state)}`);
    expect(response.status).toBe(200);

    const result = await pending;
    expect(result.access).toBe("at");
    expect(result.refresh).toBe("rt|proj-login");
    expect(result.projectId).toBe("proj-login");
    expect(result.expires).toBeGreaterThan(Date.now());
  }, 15000);
});
