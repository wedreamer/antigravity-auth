import {
  ANTIGRAVITY_CLIENT_ID,
  ANTIGRAVITY_CLIENT_SECRET,
  ANTIGRAVITY_ENDPOINT_FALLBACKS,
  ANTIGRAVITY_ENDPOINT_PROD,
  ANTIGRAVITY_SCOPES,
} from "../constants";
import { OPENCODE_MODEL_DEFINITIONS, type OpencodeModelDefinition } from "../plugin/config/models";
import { formatRefreshParts, parseRefreshParts } from "../plugin/auth";
import type { RefreshParts } from "../plugin/types";

/**
 * Host-neutral provider identity shared by every adapter.
 *
 * The OpenCode plugin exposes these models under its own provider id, and the pi/senpi extension
 * registers them under the same id so `--model google-antigravity/<model>` names one thing on both
 * hosts. Nothing in this module may import a host SDK: it is the seam both adapters read.
 */
export const SHARED_PROVIDER_ID = "google-antigravity";

export interface SharedModelDefinition {
  id: string;
  name: string;
  reasoning: boolean;
  input: readonly ("text" | "image")[];
  contextWindow: number;
  maxTokens: number;
  cost: { input: number; output: number; cacheRead: number; cacheWrite: number };
  variants?: OpencodeModelDefinition["variants"];
}

const ZERO_COST = { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 } as const;

export function isClaudeModelId(modelId: string): boolean {
  return /claude/i.test(modelId);
}

/**
 * senpi accepts only `text | image | video` for a model's `input`, while the Antigravity catalog
 * also declares `pdf`. Dropping `pdf` here is what keeps the generated provider config valid — a
 * single invalid modality silently disables the whole `models.json`.
 */
function toSenpiInput(modalities: readonly string[]): ("text" | "image")[] {
  const mapped = modalities.filter((m): m is "text" | "image" => m === "text" || m === "image");
  return mapped.length > 0 ? mapped : ["text"];
}

export function listSharedModels(): SharedModelDefinition[] {
  return Object.entries(OPENCODE_MODEL_DEFINITIONS).map(([id, definition]) => ({
    id,
    name: definition.name,
    reasoning: isClaudeModelId(id) || Boolean(definition.variants),
    input: toSenpiInput(definition.modalities.input),
    contextWindow: definition.limit.context,
    maxTokens: definition.limit.output,
    cost: { ...ZERO_COST },
    variants: definition.variants,
  }));
}

export function getSharedModel(modelId: string): SharedModelDefinition | undefined {
  return listSharedModels().find((model) => model.id === modelId);
}

/**
 * The stored Antigravity credential packs the refresh token with up to two project ids into one
 * string. Both hosts must read and write that one format or a login performed on one host becomes
 * unusable on the other.
 */
export interface SharedRefreshIdentity {
  refreshToken: string;
  projectId?: string;
  managedProjectId?: string;
}

export function readSharedRefresh(stored: string): SharedRefreshIdentity {
  const parts: RefreshParts = parseRefreshParts(stored);
  return {
    refreshToken: parts.refreshToken,
    projectId: parts.projectId,
    managedProjectId: parts.managedProjectId,
  };
}

export function writeSharedRefresh(identity: SharedRefreshIdentity): string {
  return formatRefreshParts(identity);
}

export interface SharedAuthEntry {
  type: "oauth";
  access: string;
  refresh: string;
  expires: number;
}

export function toSharedAuthEntry(identity: SharedRefreshIdentity, access: string, expires: number): SharedAuthEntry {
  return {
    type: "oauth",
    access,
    refresh: writeSharedRefresh(identity),
    expires,
  };
}

export const SHARED_ENDPOINT_FALLBACKS = ANTIGRAVITY_ENDPOINT_FALLBACKS;
export const SHARED_LOAD_ENDPOINT = ANTIGRAVITY_ENDPOINT_PROD;
export const SHARED_OAUTH_CLIENT = {
  clientId: ANTIGRAVITY_CLIENT_ID,
  clientSecret: ANTIGRAVITY_CLIENT_SECRET,
  scopes: ANTIGRAVITY_SCOPES,
} as const;
