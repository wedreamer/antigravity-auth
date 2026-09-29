import {
  ANTIGRAVITY_SYSTEM_INSTRUCTION,
  applyToolPairingFixes,
  cleanJSONSchemaForAntigravity,
  configureClaudeToolConfig,
  getAntigravityHeaders,
  isClaudeModel,
  sanitizeRequestPayloadForAntigravity,
} from "../../src/shared/index.ts";

export interface SenpiContentPart {
  type: string;
  text?: string;
  thinking?: string;
  id?: string;
  name?: string;
  arguments?: Record<string, unknown>;
  data?: string;
  mimeType?: string;
  toolCallId?: string;
  toolName?: string;
  isError?: boolean;
  content?: unknown;
  [key: string]: unknown;
}

export interface SenpiMessage {
  role: string;
  content?: string | SenpiContentPart[];
  toolCallId?: string;
  toolName?: string;
  isError?: boolean;
  [key: string]: unknown;
}

export interface SenpiToolSchema {
  name?: string;
  description?: string;
  parameters?: unknown;
  [key: string]: unknown;
}

export interface SenpiTool {
  name?: string;
  description?: string;
  parameters?: unknown;
  functionDeclarations?: SenpiToolSchema[];
  function_declarations?: SenpiToolSchema[];
  [key: string]: unknown;
}

export interface GeminiPart {
  [key: string]: unknown;
}

export function toGeminiRole(role: string): "user" | "model" {
  return role === "assistant" ? "model" : "user";
}

function textParts(parts: SenpiContentPart[]): GeminiPart[] {
  const out: GeminiPart[] = [];
  for (const part of parts) {
    if (!part || typeof part !== "object") continue;
    if (part.type === "text" && typeof part.text === "string" && part.text.length > 0) out.push({ text: part.text });
    else if (part.type === "thinking" && typeof part.thinking === "string") out.push({ text: part.thinking });
    else if (part.type === "image" && typeof part.data === "string" && typeof part.mimeType === "string") {
      out.push({ inlineData: { mimeType: part.mimeType, data: part.data } });
    } else if (part.type === "toolCall") {
      out.push({ functionCall: { name: part.name ?? "", args: part.arguments ?? {} } });
    }
  }
  return out;
}

export function toolResultToParts(message: SenpiMessage): GeminiPart[] {
  const parts: GeminiPart[] = [];
  const blocks: SenpiContentPart[] = [];
  if (typeof message.content === "string") {
    blocks.push({ type: "text", text: message.content });
  } else if (Array.isArray(message.content)) {
    blocks.push(...message.content);
  }
  for (const block of blocks) {
    if (!block || typeof block !== "object") continue;
    if (block.type === "text" && typeof block.text === "string") {
      parts.push({ text: block.text });
    } else if (block.type === "image" && typeof block.data === "string" && typeof block.mimeType === "string") {
      parts.push({ inlineData: { mimeType: block.mimeType, data: block.data } });
    }
  }
  const response: Record<string, unknown> = { content: parts };
  // A failed tool must be distinguishable from a successful one: without this the model reads a
  // failure as a normal result and proceeds as if the work succeeded.
  if (message.isError === true) response.error = true;
  const functionResponse: Record<string, unknown> = { name: message.toolName ?? "", response };
  if (typeof message.toolCallId === "string" && message.toolCallId.length > 0) {
    functionResponse.id = message.toolCallId;
  }
  return [{ functionResponse }];
}

export function messageToContents(message: SenpiMessage): { role: "user" | "model"; parts: GeminiPart[] } | undefined {
  if (message.role === "toolResult") {
    const parts = toolResultToParts(message);
    return parts.length > 0 ? { role: "user", parts } : undefined;
  }
  const parts = typeof message.content === "string"
    ? (message.content.length > 0 ? [{ text: message.content }] : [])
    : Array.isArray(message.content)
      ? textParts(message.content)
      : [];
  if (parts.length === 0) return undefined;
  return { role: toGeminiRole(message.role), parts };
}

export function messagesToContents(messages: unknown[] | undefined): { role: "user" | "model"; parts: GeminiPart[] }[] {
  if (!Array.isArray(messages)) return [];
  const contents: { role: "user" | "model"; parts: GeminiPart[] }[] = [];
  for (const message of messages) {
    if (!message || typeof message !== "object") continue;
    const converted = messageToContents(message as SenpiMessage);
    if (converted) contents.push(converted);
  }
  return contents;
}

function declarationFrom(tool: SenpiToolSchema): Record<string, unknown> | undefined {
  if (!tool || typeof tool !== "object") return undefined;
  if (typeof tool.name !== "string" || tool.name.length === 0) return undefined;
  const declaration: Record<string, unknown> = { name: tool.name };
  if (typeof tool.description === "string") declaration.description = tool.description;
  if (tool.parameters && typeof tool.parameters === "object") {
    declaration.parameters = cleanJSONSchemaForAntigravity(tool.parameters);
  }
  return declaration;
}

export function toolsToGeminiDeclarations(tools: unknown[] | undefined): { functionDeclarations: Record<string, unknown>[] }[] {
  if (!Array.isArray(tools) || tools.length === 0) return [];
  const declarations: Record<string, unknown>[] = [];
  for (const tool of tools) {
    if (!tool || typeof tool !== "object") continue;
    const record = tool as SenpiTool;
    const nested = record.functionDeclarations ?? record.function_declarations;
    if (Array.isArray(nested)) {
      for (const inner of nested) {
        const declaration = declarationFrom(inner);
        if (declaration) declarations.push(declaration);
      }
      continue;
    }
    const declaration = declarationFrom(record);
    if (declaration) declarations.push(declaration);
  }
  return declarations.length > 0 ? [{ functionDeclarations: declarations }] : [];
}

/**
 * Claude models are served by Anthropic semantics behind the same endpoint: tool calls must carry an
 * id and results must reference it, or the backend rejects the turn with
 * `messages.1.content.1.tool_use.id: Field required`. The fork already owns that repair in
 * applyToolPairingFixes(); reusing it keeps one policy for both hosts.
 */
export function applyClaudeToolRepairs(request: Record<string, unknown>, modelId: string): void {
  if (!isClaudeModel(modelId)) return;
  configureClaudeToolConfig(request as never);
  applyToolPairingFixes(request, true);
}

const CLI_USER_AGENT =
  "antigravity/cli/1.1.12 (aidev_client; os_type=linux; arch=amd64; cl=962369648; auth_method=consumer)";

const GEMINI_37_38_FLASH = /gemini-3\.[78]-flash/i;

/**
 * The Antigravity backend is picky in ways that look like quota errors and are not. Verified against
 * the live service: prod answers these requests with 403 VALIDATION_REQUIRED while the daily sandbox
 * serves them, gemini-3.7/3.8-flash are ONLY served to the official CLI User-Agent (any other UA is
 * rejected), and antigravity mode must send no X-Goog-Api-Client/Client-Metadata header at all - the
 * ideType travels in the body metadata instead. This mirrors src/plugin/request.ts, which is the
 * shape OpenCode has shipped and debugged.
 */
export function antigravityRequestHeaders(accessToken: string, modelId: string): Record<string, string> {
  return {
    Authorization: `Bearer ${accessToken}`,
    "Content-Type": "application/json",
    Accept: "text/event-stream",
    "User-Agent": GEMINI_37_38_FLASH.test(modelId) ? CLI_USER_AGENT : getAntigravityHeaders()["User-Agent"],
  };
}

export function buildWrappedBody(params: {
  project: string;
  model: string;
  contents: unknown[];
  tools?: unknown[];
  systemPrompt?: string;
  sessionId: string;
  requestId?: string;
}): Record<string, unknown> {
  const request: Record<string, unknown> = { contents: params.contents, sessionId: params.sessionId };
  const tools = toolsToGeminiDeclarations(params.tools);
  if (tools.length > 0) request.tools = tools;
  request.systemInstruction = {
    role: "user",
    parts: [{ text: composeSystemInstruction(params.systemPrompt) }],
  };
  sanitizeRequestPayloadForAntigravity(request);
  applyClaudeToolRepairs(request, params.model);
  return {
    project: params.project,
    model: params.model,
    request,
    requestType: "agent",
    userAgent: "antigravity",
    requestId: params.requestId ?? `agent-${globalThis.crypto.randomUUID()}`,
  };
}

/**
 * The Antigravity instruction must be PREPENDED to the host's system prompt, never substituted for
 * it: replacing it silently discards the entire agent prompt (omo's project rules, tool guidance).
 * This matches src/plugin/request.ts, which prepends the same constant on the OpenCode path.
 */
export function composeSystemInstruction(systemPrompt?: string): string {
  const hostPrompt = (systemPrompt ?? "").trim();
  return hostPrompt ? `${ANTIGRAVITY_SYSTEM_INSTRUCTION}\n\n${hostPrompt}` : ANTIGRAVITY_SYSTEM_INSTRUCTION;
}
