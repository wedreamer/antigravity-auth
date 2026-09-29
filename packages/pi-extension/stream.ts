import {
  ANTIGRAVITY_ENDPOINT,
  resolveAntigravityGemini35FlashBackendModel,
  resolveAntigravityGemini36FlashBackendModel,
  resolveAntigravityGemini37FlashBackendModel,
  resolveAntigravityGemini38FlashBackendModel,
  resolveModelWithTier,
} from "../../src/shared/index.ts";
import { randomUUID } from "node:crypto";
import { antigravityRequestHeaders, buildWrappedBody } from "./gemini-shape.ts";

/**
 * Gemini 3.5-3.8 Flash only answer to a tier-suffixed backend name: `gemini-3.8-flash` is rejected
 * with HTTP 404 Requested entity was not found, while `gemini-3.8-flash-low|medium|high` is served.
 * Verified against the live sandbox endpoint. This mirrors the resolution request.ts performs for
 * antigravity header style, so the extension names models exactly as OpenCode does.
 */
export function resolveBackendModelId(providerModelId: string, thinkingLevel?: string): string {
  const resolved = resolveModelWithTier(providerModelId);
  const base = resolved.actualModel;
  const tiered =
    resolveAntigravityGemini38FlashBackendModel(base, thinkingLevel ?? resolved.thinkingLevel) ??
    resolveAntigravityGemini37FlashBackendModel(base, thinkingLevel ?? resolved.thinkingLevel) ??
    resolveAntigravityGemini36FlashBackendModel(base, thinkingLevel ?? resolved.thinkingLevel) ??
    resolveAntigravityGemini35FlashBackendModel(base, thinkingLevel ?? resolved.thinkingLevel);
  return tiered ?? base;
}
import { resolveProjectId } from "./project-id.ts";

export interface StreamModelLike {
  id: string;
  api: string;
  provider: string;
  baseUrl?: string;
  [key: string]: unknown;
}

export interface StreamUsage {
  input: number;
  output: number;
  cacheRead: number;
  cacheWrite: number;
  totalTokens: number;
  cost: { input: number; output: number; cacheRead: number; cacheWrite: number; total: number };
}

export interface StreamContentBlock {
  type: "text" | "thinking" | "toolCall";
  text?: string;
  thinking?: string;
  id?: string;
  name?: string;
  arguments?: Record<string, unknown>;
}

export interface StreamAssistantMessage {
  role: "assistant";
  content: StreamContentBlock[];
  api: string;
  provider: string;
  model: string;
  usage: StreamUsage;
  stopReason: string;
  timestamp: number;
  errorMessage?: string;
  rawStopReason?: string;
}

export interface StreamEventSink {
  push(event: Record<string, unknown>): void;
  end(result?: StreamAssistantMessage): void;
  fail(error: unknown): void;
}
export interface ResolvedTurnCredential {
  accessToken: string;
  storedRefresh: string;
  account: string;
}

export interface TurnInput {
  modelId: string;
  provider: string;
  api: string;
  contents: unknown[];
  tools?: unknown[];
  systemPrompt?: string;
  accessToken: string;
  storedRefresh: string;
  fetchImpl?: typeof fetch;
  signal?: AbortSignal;
  credentialSource?: (modelId: string) => Promise<ResolvedTurnCredential>;
}

export function emptyUsage(): StreamUsage {
  return {
    input: 0,
    output: 0,
    cacheRead: 0,
    cacheWrite: 0,
    totalTokens: 0,
    cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
  };
}

export function initialMessage(input: TurnInput): StreamAssistantMessage {
  return {
    role: "assistant",
    content: [],
    api: input.api,
    provider: input.provider,
    model: input.modelId,
    usage: emptyUsage(),
    stopReason: "pending",
    timestamp: Date.now(),
  };
}

export function buildRequestBody(input: Pick<TurnInput, "contents" | "tools" | "systemPrompt" | "modelId"> & { projectId: string; sessionId: string }): Record<string, unknown> {
  return buildWrappedBody({
    project: input.projectId,
    model: resolveBackendModelId(input.modelId),
    contents: input.contents,
    tools: input.tools,
    systemPrompt: input.systemPrompt,
    sessionId: input.sessionId,
  });
}

export function parseSseDataLine(line: string): Record<string, unknown> | undefined {
  const trimmed = line.trim();
  if (!trimmed.startsWith("data:")) return undefined;
  const payload = trimmed.slice(5).trim();
  if (!payload || payload === "[DONE]") return undefined;
  try {
    const parsed = JSON.parse(payload);
    return parsed && typeof parsed === "object" ? (parsed as Record<string, unknown>) : undefined;
  } catch {
    return undefined;
  }
}

function responseOf(chunk: Record<string, unknown>): Record<string, unknown> {
  const inner = chunk.response;
  return inner && typeof inner === "object" ? (inner as Record<string, unknown>) : chunk;
}

export function extractText(chunk: Record<string, unknown>): string {
  const candidates = responseOf(chunk).candidates;
  if (!Array.isArray(candidates)) return "";
  let text = "";
  for (const candidate of candidates) {
    if (!candidate || typeof candidate !== "object") continue;
    const content = (candidate as Record<string, unknown>).content;
    if (!content || typeof content !== "object") continue;
    const parts = (content as Record<string, unknown>).parts;
    if (!Array.isArray(parts)) continue;
    for (const part of parts) {
      if (!part || typeof part !== "object") continue;
      const value = (part as Record<string, unknown>).text;
      if (typeof value === "string") text += value;
    }
  }
  return text;
}

export function extractFunctionCalls(chunk: Record<string, unknown>): { name: string; args: Record<string, unknown> }[] {
  const candidates = responseOf(chunk).candidates;
  if (!Array.isArray(candidates)) return [];
  const calls: { name: string; args: Record<string, unknown> }[] = [];
  for (const candidate of candidates) {
    if (!candidate || typeof candidate !== "object") continue;
    const content = (candidate as Record<string, unknown>).content;
    if (!content || typeof content !== "object") continue;
    const parts = (content as Record<string, unknown>).parts;
    if (!Array.isArray(parts)) continue;
    for (const part of parts) {
      if (!part || typeof part !== "object") continue;
      const call = (part as Record<string, unknown>).functionCall;
      if (!call || typeof call !== "object") continue;
      const name = (call as Record<string, unknown>).name;
      if (typeof name !== "string") continue;
      const args = (call as Record<string, unknown>).args;
      calls.push({ name, args: args && typeof args === "object" ? (args as Record<string, unknown>) : {} });
    }
  }
  return calls;
}

export function extractUsage(chunk: Record<string, unknown>): { input: number; output: number } | undefined {
  const meta = responseOf(chunk).usageMetadata;
  if (!meta || typeof meta !== "object") return undefined;
  const record = meta as Record<string, unknown>;
  const prompt = record.promptTokenCount;
  const candidates = record.candidatesTokenCount;
  if (typeof prompt !== "number" && typeof candidates !== "number") return undefined;
  return { input: typeof prompt === "number" ? prompt : 0, output: typeof candidates === "number" ? candidates : 0 };
}

export function extractFinishReason(chunk: Record<string, unknown>): string | undefined {
  const candidates = responseOf(chunk).candidates;
  if (!Array.isArray(candidates) || candidates.length === 0) return undefined;
  const first = candidates[0];
  if (!first || typeof first !== "object") return undefined;
  const reason = (first as Record<string, unknown>).finishReason;
  return typeof reason === "string" ? reason : undefined;
}

/**
 * Antigravity streams Google-style SSE from `/v1internal:<action>?alt=sse`. This translator keeps
 * one mutable AssistantMessage, mutates it as parts arrive, and pushes senpi's event union with the
 * message attached as `partial` on every event - the contract senpi's TUI and tool loop read.
 */
export async function runTurn(input: TurnInput, sink: StreamEventSink): Promise<void> {
  const message = initialMessage(input);
  sink.push({ type: "start", partial: message });

  const doFetch = input.fetchImpl ?? fetch;
  const sessionId = randomUUID();

  try {
    const plan = input.credentialSource
      ? await input.credentialSource(input.modelId)
      : { accessToken: input.accessToken, storedRefresh: input.storedRefresh, account: "single" };
    const projectId = resolveProjectId(plan.storedRefresh);
    const targetUrl = `${ANTIGRAVITY_ENDPOINT}/v1internal:streamGenerateContent?alt=sse`;
    const requestInit: RequestInit = {
      method: "POST",
      headers: antigravityRequestHeaders(plan.accessToken, input.modelId),
      body: JSON.stringify(buildRequestBody({ ...input, projectId, sessionId })),
      signal: input.signal,
    };
    const response = await doFetch(targetUrl, requestInit);
    if (!response.ok) {
      const detail = await response.text().catch(() => "");
      throw new Error(`Antigravity request failed: ${response.status} ${response.statusText}${detail ? ` - ${detail.slice(0, 300)}` : ""}`);
    }

    const textIndex = { value: -1 };
    if (response.body) {
      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split("\n");
        buffer = lines.pop() ?? "";
        for (const line of lines) {
          const chunk = parseSseDataLine(line);
          if (chunk) emitChunk(chunk, message, sink, textIndex);
        }
      }
      const tail = parseSseDataLine(buffer);
      if (tail) emitChunk(tail, message, sink, textIndex);
    } else {
      const whole = await response.text();
      for (const line of whole.split("\n")) {
        const chunk = parseSseDataLine(line);
        if (chunk) emitChunk(chunk, message, sink, textIndex);
      }
    }

    closeOpenText(message, sink, textIndex);
    const stopReason = message.content.some((block) => block.type === "toolCall")
      ? "toolUse"
      : message.rawStopReason === "MAX_TOKENS"
        ? "length"
        : "stop";
    message.stopReason = stopReason;
    sink.push({ type: "done", reason: stopReason, message });
    sink.end(message);
  } catch (error) {
    const aborted = input.signal?.aborted === true;
    message.stopReason = aborted ? "aborted" : "error";
    message.errorMessage = error instanceof Error ? error.message : String(error);
    sink.push({ type: "error", reason: message.stopReason, error: message });
    if (!aborted) sink.fail(error);
    else sink.end(message);
  }
}

function closeOpenText(message: StreamAssistantMessage, sink: StreamEventSink, textIndex: { value: number }): void {
  if (textIndex.value < 0) return;
  const block = message.content[textIndex.value];
  if (!block) return;
  sink.push({ type: "text_end", contentIndex: textIndex.value, content: block.text ?? "", partial: message });
  textIndex.value = -1;
}

function emitChunk(chunk: Record<string, unknown>, message: StreamAssistantMessage, sink: StreamEventSink, textIndex: { value: number }): void {
  const usage = extractUsage(chunk);
  if (usage) {
    message.usage.input = usage.input;
    message.usage.output = usage.output;
    message.usage.totalTokens = usage.input + usage.output;
  }

  const text = extractText(chunk);
  if (text) {
    if (textIndex.value < 0) {
      message.content.push({ type: "text", text: "" });
      textIndex.value = message.content.length - 1;
      sink.push({ type: "text_start", contentIndex: textIndex.value, partial: message });
    }
    const block = message.content[textIndex.value];
    if (block) block.text = (block.text ?? "") + text;
    sink.push({ type: "text_delta", contentIndex: textIndex.value, delta: text, partial: message });
  }

  for (const call of extractFunctionCalls(chunk)) {
    // A text block must be closed BEFORE a tool call starts: the host's event reducer rejects
    // text_end arriving after toolcall_end with "Invalid native tool call event order", which
    // aborted real Claude turns.
    closeOpenText(message, sink, textIndex);
    const index = message.content.length;
    const toolCall = { type: "toolCall" as const, id: `${call.name}-${index}`, name: call.name, arguments: call.args };
    message.content.push(toolCall);
    sink.push({ type: "toolcall_start", contentIndex: index, partial: message });
    sink.push({ type: "toolcall_delta", contentIndex: index, delta: JSON.stringify(call.args), partial: message });
    sink.push({ type: "toolcall_end", contentIndex: index, toolCall, partial: message });
  }

  const finish = extractFinishReason(chunk);
  if (finish) message.rawStopReason = finish;
}
