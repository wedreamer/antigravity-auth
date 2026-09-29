import { existsSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { createAssistantMessageEventStream } from "@earendil-works/pi-ai/compat";
import {
  ANTIGRAVITY_DEFAULT_PROJECT_ID,
  ANTIGRAVITY_ENDPOINT,
  SHARED_PROVIDER_ID,
  listSharedModels,
  type SharedModelDefinition,
} from "../../src/shared/index.ts";
import { messagesToContents } from "./gemini-shape.ts";
import { loginAntigravity, refreshAntigravity, getApiKey } from "./oauth.ts";
import { resolveProjectId } from "./project-id.ts";
import {
  initialMessage,
  runTurn,
  type StreamEventSink,
  type TurnInput,
} from "./stream.ts";
import { resolveTurnCredential } from "./credential-source.ts";

export const PROVIDER_ID = SHARED_PROVIDER_ID;
export const PROVIDER_API_ID = "antigravity-code-assist";

/**
 * Raised when the extension cannot obtain a usable Antigravity credential from the agent's auth
 * file. Distinct from a transport error so a caller can tell "this machine is not logged in" apart
 * from "the backend refused the token". A malformed auth file is reported, never silently treated
 * as logged out: an empty credential would otherwise surface later as a confusing default-project
 * request against the wrong account.
 */
export class AntigravityCredentialError extends Error {
  readonly code: "missing-credential" | "malformed-credential" | "missing-refresh-token";

  constructor(code: AntigravityCredentialError["code"], message: string) {
    super(message);
    this.name = "AntigravityCredentialError";
    this.code = code;
  }
}

export type SenpiInput = "text" | "image";

export interface SenpiModelEntry {
  id: string;
  name: string;
  reasoning: boolean;
  input: SenpiInput[];
  cost: { input: number; output: number; cacheRead: number; cacheWrite: number };
  contextWindow: number;
  maxTokens: number;
}

export function toSenpiModel(definition: SharedModelDefinition): SenpiModelEntry {
  return {
    id: definition.id,
    name: definition.name,
    reasoning: definition.reasoning,
    input: [...definition.input],
    cost: { ...definition.cost },
    contextWindow: definition.contextWindow,
    maxTokens: definition.maxTokens,
  };
}

export function buildModelEntries(): SenpiModelEntry[] {
  return listSharedModels().map(toSenpiModel);
}

export function defaultProjectId(): string {
  return ANTIGRAVITY_DEFAULT_PROJECT_ID;
}

export function projectIdFor(storedRefresh: string): string {
  return resolveProjectId(storedRefresh);
}

export interface AntigravityTurnRequest {
  model: { id: string };
  contents: unknown[];
  tools?: unknown[];
  systemPrompt?: string;
  accessToken: string;
  storedRefresh: string;
  fetchImpl?: typeof fetch;
  signal?: AbortSignal;
  credentialSource?: (modelId: string) => Promise<{ accessToken: string; storedRefresh: string; account: string }>;
}

export function runExtensionTurn(request: AntigravityTurnRequest, sink: StreamEventSink): Promise<void> {
  const input: TurnInput = {
    modelId: request.model.id,
    provider: PROVIDER_ID,
    api: PROVIDER_API_ID,
    contents: messagesToContents(request.contents),
    tools: request.tools,
    systemPrompt: request.systemPrompt,
    accessToken: request.accessToken,
    storedRefresh: request.storedRefresh,
    fetchImpl: request.fetchImpl,
    signal: request.signal,
    credentialSource: request.credentialSource,
  };
  return runTurn(input, sink);
}

export interface ExtensionApiLike {
  registerProvider(id: string, config: Record<string, unknown>): void;
}

export function registerAntigravityProvider(pi: ExtensionApiLike): void {
  pi.registerProvider(PROVIDER_ID, {
    baseUrl: ANTIGRAVITY_ENDPOINT,
    api: PROVIDER_API_ID,
    models: buildModelEntries(),
    oauth: {
      name: "Google Antigravity",
      login: loginAntigravity,
      refreshToken: refreshAntigravity,
      getApiKey,
    },
    streamSimple: (model: { id: string }, context: { messages?: unknown[]; tools?: unknown[]; systemPrompt?: string }, options?: { apiKey?: string; signal?: AbortSignal }) => {
      const stream = createAssistantMessageEventStream();
      const sink = stream as unknown as StreamEventSink;
      void runExtensionTurn(
        {
          model: { id: model.id },
          contents: context.messages ?? [],
          tools: context.tools,
          systemPrompt: context.systemPrompt,
          accessToken: options?.apiKey ?? "",
          storedRefresh: "",
          signal: options?.signal,
          credentialSource: (modelId: string) => resolveTurnCredential(modelId),
        },
        sink,
      );
      return stream;
    },
  });
}

export function readStoredRefresh(authFilePath = defaultAuthFilePath()): string {
  let raw: string;
  try {
    raw = readFileSync(authFilePath, "utf-8");
  } catch {
    throw new AntigravityCredentialError("missing-credential", `Antigravity is not logged in: ${authFilePath} does not exist. Run /login ${PROVIDER_ID} first.`);
  }
  let parsed: Record<string, { refresh?: unknown }>;
  try {
    parsed = JSON.parse(raw) as Record<string, { refresh?: unknown }>;
  } catch {
    throw new AntigravityCredentialError("malformed-credential", `The auth file ${authFilePath} is not valid JSON; refusing to continue with unknown credentials.`);
  }
  const refresh = parsed[PROVIDER_ID]?.refresh;
  if (typeof refresh !== "string" || refresh.length === 0) {
    throw new AntigravityCredentialError("missing-refresh-token", `No stored Antigravity refresh token for provider ${PROVIDER_ID}. Run /login ${PROVIDER_ID} first.`);
  }
  return refresh;
}

function defaultAuthFilePath(): string {
  const agentDir =
    process.env.SENPI_CODING_AGENT_DIR ??
    process.env.PI_CODING_AGENT_DIR ??
    process.env.CODING_AGENT_DIR ??
    process.env.OMO_CODING_AGENT_DIR ??
    firstExistingAgentDir() ??
    join(homedir(), ".omo", "agent");
  return join(agentDir, "auth.json");
}

/**
 * A stock senpi install keeps its state in ~/.senpi/agent, while omo-managed machines use
 * ~/.omo/agent. Without an env var to disambiguate, prefer whichever directory actually exists so a
 * bare `senpi` invocation and an `omo` invocation read the same credential file.
 */
function firstExistingAgentDir(): string | undefined {
  for (const candidate of [join(homedir(), ".omo", "agent"), join(homedir(), ".senpi", "agent")]) {
    if (existsSync(join(candidate, "auth.json"))) return candidate;
  }
  return undefined;
}

export default function antigravityExtension(pi: ExtensionApiLike): void {
  registerAntigravityProvider(pi);
}
