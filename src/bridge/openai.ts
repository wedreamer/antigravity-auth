import type { ChatRequest, CompletionResult, OpenAITool } from "./types.ts"

export const BRIDGE_MODELS = [
  "gemini-3.8-flash",
  "gemini-3.7-flash",
  "gemini-3.6-flash",
  "gemini-3.1-pro",
] as const

export function normalizeModel(model: string | undefined): string {
  const raw = (model || "gemini-3.8-flash").trim()
  const stripped = raw.replace(/^antigravity-/, "")
  return stripped || "gemini-3.8-flash"
}

function textFromContent(content: unknown): string {
  if (typeof content === "string") return content
  if (!Array.isArray(content)) return ""
  const parts: string[] = []
  for (const part of content) {
    if (!part || typeof part !== "object") continue
    const record = part as Record<string, unknown>
    if (typeof record.text === "string") parts.push(record.text)
    if (typeof record.content === "string") parts.push(record.content)
  }
  return parts.join("\n")
}

export function toGeminiBody(request: ChatRequest, model: string): Record<string, unknown> {
  const contents: Array<Record<string, unknown>> = []
  const systemTexts: string[] = []
  for (const message of request.messages ?? []) {
    const role = message.role ?? "user"
    const text = textFromContent(message.content)
    if (role === "system") {
      if (text) systemTexts.push(text)
      continue
    }
    if (role === "tool") {
      contents.push({
        role: "user",
        parts: [{
          functionResponse: {
            name: message.name ?? "tool",
            response: { result: text },
          },
        }],
      })
      continue
    }
    contents.push({
      role: role === "assistant" ? "model" : "user",
      parts: [{ text }],
    })
  }
  if (contents.length === 0) {
    contents.push({ role: "user", parts: [{ text: "" }] })
  }

  const body: Record<string, unknown> = { contents }
  if (systemTexts.length > 0) {
    body.systemInstruction = { parts: [{ text: systemTexts.join("\n\n") }] }
  }
  const generationConfig: Record<string, unknown> = {}
  if (typeof request.max_tokens === "number") {
    generationConfig.maxOutputTokens = request.max_tokens
  }
  if (typeof request.temperature === "number") {
    generationConfig.temperature = request.temperature
  }
  if (Object.keys(generationConfig).length > 0) {
    body.generationConfig = generationConfig
  }
  const declarations = functionDeclarations(request.tools)
  if (declarations.length > 0) {
    body.tools = [{ functionDeclarations: declarations }]
  }
  body.model = model
  return body
}

function functionDeclarations(tools: OpenAITool[] | undefined): Array<Record<string, unknown>> {
  if (!tools) return []
  const declarations: Array<Record<string, unknown>> = []
  for (const tool of tools) {
    const name = tool.function?.name
    if (!name) continue
    const declaration: Record<string, unknown> = { name }
    if (tool.function?.description) declaration.description = tool.function.description
    if (tool.function?.parameters) declaration.parameters = tool.function.parameters
    declarations.push(declaration)
  }
  return declarations
}

export function geminiUrl(model: string, stream: boolean): string {
  const action = stream ? "streamGenerateContent" : "generateContent"
  return `https://generativelanguage.googleapis.com/v1beta/models/${model}:${action}`
}

export function extractCompletion(payload: unknown, model: string): CompletionResult {
  const textParts: string[] = []
  const toolCalls: CompletionResult["toolCalls"] = []
  for (const part of geminiParts(payload)) {
    if (typeof part.text === "string" && part.text && part.thought !== true) {
      textParts.push(part.text)
    }
    const call = part.functionCall
    if (call && typeof call === "object") {
      const record = call as Record<string, unknown>
      const name = typeof record.name === "string" ? record.name : "tool"
      toolCalls.push({
        id: `call_${toolCalls.length + 1}`,
        name,
        arguments: JSON.stringify(record.args ?? {}),
      })
    }
  }
  return { model, text: textParts.join(""), accountId: "", toolCalls }
}

function geminiParts(payload: unknown): Array<Record<string, unknown>> {
  const root = asRecord(payload)
  const response = asRecord(root?.response) ?? root
  const candidates = response?.candidates
  if (!Array.isArray(candidates)) return []
  const first = asRecord(candidates[0])
  const content = asRecord(first?.content)
  const parts = content?.parts
  if (!Array.isArray(parts)) return []
  return parts.filter((part): part is Record<string, unknown> => !!part && typeof part === "object")
}

function asRecord(value: unknown): Record<string, unknown> | undefined {
  if (!value || typeof value !== "object" || Array.isArray(value)) return undefined
  return value as Record<string, unknown>
}

export function openAICompletion(result: CompletionResult): Record<string, unknown> {
  const message: Record<string, unknown> = {
    role: "assistant",
    content: result.text,
  }
  if (result.toolCalls.length > 0) {
    message.tool_calls = result.toolCalls.map((call) => ({
      id: call.id,
      type: "function",
      function: { name: call.name, arguments: call.arguments },
    }))
  }
  return {
    id: `chatcmpl-${Date.now()}`,
    object: "chat.completion",
    created: Math.floor(Date.now() / 1000),
    model: result.model,
    choices: [{
      index: 0,
      message,
      finish_reason: result.toolCalls.length > 0 ? "tool_calls" : "stop",
    }],
  }
}

export function openAIChunk(result: CompletionResult, done: boolean): Record<string, unknown> {
  return {
    id: `chatcmpl-${Date.now()}`,
    object: "chat.completion.chunk",
    created: Math.floor(Date.now() / 1000),
    model: result.model,
    choices: [{
      index: 0,
      delta: done ? {} : { role: "assistant", content: result.text },
      finish_reason: done ? "stop" : null,
    }],
  }
}

