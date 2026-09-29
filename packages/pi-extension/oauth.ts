import { randomUUID } from "node:crypto";
import { createServer, type Server } from "node:http";
import {
  ANTIGRAVITY_CLIENT_ID,
  ANTIGRAVITY_CLIENT_SECRET,
  ANTIGRAVITY_REDIRECT_URI,
  GEMINI_CLI_HEADERS,
  getAntigravityHeaders,
} from "../../src/shared/index.ts";
import { readSharedRefresh, writeSharedRefresh } from "../../src/shared/index.ts";

export interface AntigravityLoginCallbacks {
  onAuth(params: { url: string }): void;
  onProgress?(message: string): void;
  onPrompt(params: { message: string }): Promise<string>;
}

export interface AntigravityCredentials {
  refresh: string;
  access: string;
  expires: number;
}

export interface AntigravityLoginResult extends AntigravityCredentials {
  projectId: string;
}

const TOKEN_ENDPOINT = "https://oauth2.googleapis.com/token";
const LOAD_CODE_ASSIST_ENDPOINT = "https://cloudcode-pa.googleapis.com/v1internal:loadCodeAssist";

function clientId(): string {
  return ANTIGRAVITY_CLIENT_ID;
}

function base64Url(input: Uint8Array | string): string {
  const bytes = typeof input === "string" ? new TextEncoder().encode(input) : input;
  return Buffer.from(bytes).toString("base64url");
}

async function generatePkce(): Promise<{ verifier: string; challenge: string }> {
  const verifier = base64Url(randomUUID() + randomUUID());
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(verifier));
  return { verifier, challenge: base64Url(new Uint8Array(digest)) };
}

export function buildAuthorizeUrl(challenge: string, state: string, clientIdValue: string): string {
  const url = new URL("https://accounts.google.com/o/oauth2/v2/auth");
  url.searchParams.set("client_id", clientIdValue);
  url.searchParams.set("redirect_uri", ANTIGRAVITY_REDIRECT_URI);
  url.searchParams.set("response_type", "code");
  url.searchParams.set("scope", "https://www.googleapis.com/auth/cloud-platform https://www.googleapis.com/auth/userinfo.email https://www.googleapis.com/auth/userinfo.profile");
  url.searchParams.set("code_challenge", challenge);
  url.searchParams.set("code_challenge_method", "S256");
  url.searchParams.set("state", state);
  url.searchParams.set("access_type", "offline");
  url.searchParams.set("prompt", "consent");
  return url.toString();
}

export function startCallbackServer(timeoutMs = 300_000): { server: Server; waitForCode: Promise<string>; close: () => Promise<void> } {
  const redirect = new URL(ANTIGRAVITY_REDIRECT_URI);
  let settle: (code: string) => void;
  let fail: (error: Error) => void;
  const waitForCode = new Promise<string>((resolve, reject) => {
    settle = resolve;
    fail = reject;
  });
  const server = createServer((request, response) => {
    const requestUrl = new URL(request.url ?? "/", ANTIGRAVITY_REDIRECT_URI);
    const code = requestUrl.searchParams.get("code");
    response.writeHead(200, { "Content-Type": "text/plain; charset=utf-8" });
    response.end(code ? "Antigravity authorization complete. You may close this tab." : "Missing authorization code.");
    if (code) settle(code);
    else fail(new Error("Callback carried no authorization code"));
  });
  const timer = setTimeout(() => fail(new Error("Timed out waiting for the Antigravity OAuth callback")), timeoutMs);
  server.listen(Number(redirect.port), redirect.hostname);
  return {
    server,
    waitForCode,
    close: async () => {
      clearTimeout(timer);
      await new Promise<void>((resolve) => server.close(() => resolve()));
    },
  };
}

export function exchangeCodeForTokens(params: {
  code: string;
  verifier: string;
  clientId: string;
  clientSecret: string;
  fetchImpl?: typeof fetch;
}): Promise<{ access_token: string; refresh_token?: string; expires_in: number }> {
  const doFetch = params.fetchImpl ?? fetch;
  return doFetch(TOKEN_ENDPOINT, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded;charset=UTF-8" },
    body: new URLSearchParams({
      client_id: params.clientId,
      client_secret: params.clientSecret,
      code: params.code,
      grant_type: "authorization_code",
      redirect_uri: ANTIGRAVITY_REDIRECT_URI,
      code_verifier: params.verifier,
    }),
  }).then(async (response) => {
    if (!response.ok) throw new Error(`Antigravity token exchange failed: ${response.status} ${await response.text()}`);
    return (await response.json()) as { access_token: string; refresh_token?: string; expires_in: number };
  });
}

export function refreshAccessToken(params: {
  refreshToken: string;
  clientId: string;
  clientSecret: string;
  signal?: AbortSignal;
  fetchImpl?: typeof fetch;
}): Promise<{ access_token: string; refresh_token?: string; expires_in: number }> {
  const doFetch = params.fetchImpl ?? fetch;
  return doFetch(TOKEN_ENDPOINT, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "refresh_token",
      refresh_token: params.refreshToken,
      client_id: params.clientId,
      client_secret: params.clientSecret,
    }),
    signal: params.signal,
  }).then(async (response) => {
    if (!response.ok) throw new Error(`Antigravity token refresh failed: ${response.status} ${await response.text()}`);
    return (await response.json()) as { access_token: string; refresh_token?: string; expires_in: number };
  });
}

export async function resolveProjectId(accessToken: string, fetchImpl: typeof fetch = fetch): Promise<string> {
  const response = await fetchImpl(LOAD_CODE_ASSIST_ENDPOINT, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${accessToken}`,
      "Content-Type": "application/json",
      ...GEMINI_CLI_HEADERS,
      "Client-Metadata": getAntigravityHeaders()["Client-Metadata"],
    },
    body: JSON.stringify({
      metadata: { ideType: "ANTIGRAVITY", platform: "PLATFORM_UNSPECIFIED", pluginType: "GEMINI" },
    }),
  });
  if (!response.ok) return "";
  const data = (await response.json()) as { cloudaicompanionProject?: string | { id?: string } };
  const project = data.cloudaicompanionProject;
  if (typeof project === "string") return project;
  return typeof project?.id === "string" ? project.id : "";
}

export async function loginAntigravity(callbacks: AntigravityLoginCallbacks, fetchImpl: typeof fetch = fetch): Promise<AntigravityLoginResult> {
  const { verifier, challenge } = await generatePkce();
  const state = randomUUID();
  const id = clientId();
  const listener = startCallbackServer();
  try {
    callbacks.onAuth({ url: buildAuthorizeUrl(challenge, state, id) });
    const code = await listener.waitForCode;
    callbacks.onProgress?.("Exchanging the Antigravity authorization code");
    const tokens = await exchangeCodeForTokens({ code, verifier, clientId: id, clientSecret: ANTIGRAVITY_CLIENT_SECRET, fetchImpl });
    if (!tokens.refresh_token) throw new Error("Antigravity returned no refresh token; re-run /login and approve the consent screen");
    const projectId = await resolveProjectId(tokens.access_token, fetchImpl);
    return {
      refresh: writeSharedRefresh({ refreshToken: tokens.refresh_token, projectId: projectId || undefined }),
      access: tokens.access_token,
      expires: Date.now() + tokens.expires_in * 1000,
      projectId,
    };
  } finally {
    await listener.close();
  }
}

export async function refreshAntigravity(
  credentials: AntigravityCredentials,
  signal?: AbortSignal,
  fetchImpl: typeof fetch = fetch,
): Promise<AntigravityCredentials> {
  const identity = readSharedRefresh(credentials.refresh);
  if (!identity.refreshToken) throw new Error("Stored Antigravity credential is missing its refresh token");
  const tokens = await refreshAccessToken({
    refreshToken: identity.refreshToken,
    clientId: clientId(),
    clientSecret: ANTIGRAVITY_CLIENT_SECRET,
    signal,
    fetchImpl,
  });
  return {
    refresh: writeSharedRefresh({
      refreshToken: tokens.refresh_token ?? identity.refreshToken,
      projectId: identity.projectId,
      managedProjectId: identity.managedProjectId,
    }),
    access: tokens.access_token,
    expires: Date.now() + tokens.expires_in * 1000,
  };
}

export function getApiKey(credentials: AntigravityCredentials): string {
  return credentials.access;
}
