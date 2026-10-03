import type { ChatRequest, CompletionResult, OpenAIMessage, OpenAITool } from "./types.ts"

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
    if (record.type === "think" || record.type === "image_url" || record.type === "input_audio" || record.type === "audio_url") continue
    if (typeof record.text === "string") parts.push(record.text)
    if (typeof record.content === "string") parts.push(record.content)
  }
  return parts.join("\n")
}

function dataUrl(value: unknown): { mimeType: string; data: string } | undefined {
  const url = typeof value === "string"
    ? value
    : asRecord(value)?.url
  if (typeof url !== "string") return undefined
  const match = /^data:([^;,]+);base64,([\s\S]*)$/.exec(url)
  if (!match?.[1] || match[2] === undefined) return undefined
  return { mimeType: match[1], data: match[2] }
}

function partsFromContent(content: unknown): Array<Record<string, unknown>> | undefined {
  if (!Array.isArray(content)) return undefined
  const parts: Array<Record<string, unknown>> = []
  let sawText = false
  let sawImage = false
  let sawAudio = false
  for (const part of content) {
    if (!part || typeof part !== "object") continue
    const record = part as Record<string, unknown>
    if (record.type === "think") {
      const thought: Record<string, unknown> = {
        thought: true,
        text: typeof record.think === "string" ? record.think : "",
      }
      if (typeof record.encrypted === "string" && record.encrypted) thought.thoughtSignature = record.encrypted
      parts.push(thought)
      continue
    }
    if (record.type === "image_url") {
      const inline = dataUrl(record.image_url)
      if (inline) {
        parts.push({ inlineData: inline })
        sawImage = true
      }
      continue
    }
    if (record.type === "input_audio" || record.type === "audio_url") {
      const audio = asRecord(record.input_audio) ?? asRecord(record.audio_url) ?? record
      const inline = dataUrl(audio.data ? `data:${typeof audio.format === "string" ? audioMime(audio.format) : "application/octet-stream"};base64,${audio.data}` : audio.url ?? audio)
      if (!inline && typeof audio.data === "string" && typeof audio.format === "string") {
        parts.push({ inlineData: { mimeType: audioMime(audio.format), data: audio.data } })
        sawAudio = true
        continue
      }
      if (inline) {
        parts.push({ inlineData: inline })
        sawAudio = true
      }
      continue
    }
    if (typeof record.text === "string") {
      parts.push({ text: record.text })
      sawText = true
    }
  }
  if (!sawText && sawImage) parts.unshift({ text: "[Image]" })
  if (!sawText && sawAudio && !sawImage) parts.unshift({ text: "[Audio]" })
  return parts
}

function audioMime(format: string): string {
  if (format.includes("/")) return format
  return `audio/${format}`
}

function thoughtSignatureOf(call: { extra_content?: { google?: { thought_signature?: string } } }): string | undefined {
  const sig = call.extra_content?.google?.thought_signature
  return typeof sig === "string" && sig.length > 0 ? sig : undefined
}

function toolArgs(raw: string | undefined): Record<string, unknown> {
  if (typeof raw !== "string" || raw.length === 0) return {}
  try {
    const parsed: unknown = JSON.parse(raw)
    return asRecord(parsed) ?? {}
  } catch (error) {
    if (error instanceof SyntaxError) return {}
    throw error
  }
}

function responseName(message: OpenAIMessage, prior: readonly OpenAIMessage[]): string {
  if (typeof message.name === "string" && message.name.length > 0) return message.name
  const id = message.tool_call_id
  if (typeof id !== "string" || id.length === 0) return "tool"
  for (let index = prior.length - 1; index >= 0; index--) {
    const candidate = prior[index]
    if (!candidate || (candidate.role !== "assistant" && candidate.role !== "model")) continue
    const call = candidate.tool_calls?.find((item) => item.id === id)
    const name = call?.function?.name
    if (typeof name === "string" && name.length > 0) return name
  }
  return "tool"
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
      const functionResponse: Record<string, unknown> = {
        name: responseName(message, (request.messages ?? []).slice(0, (request.messages ?? []).indexOf(message))),
        response: { result: text },
      }
      if (message.tool_call_id) functionResponse.id = message.tool_call_id
      contents.push({
        role: "user",
        parts: [{ functionResponse }],
      })
      continue
    }
    const calls = message.tool_calls
    if ((role === "assistant" || role === "model") && calls && calls.length > 0) {
      const placed = new Set(calls.map((call) => thoughtSignatureOf(call)).filter((sig) => typeof sig === "string"))
      const thoughtParts = (partsFromContent(message.content)?.filter((part) => part.thought === true) ?? []).filter((part) => {
        const thoughtText = typeof part.text === "string" ? part.text : ""
        if (thoughtText.length > 0) return true
        const sig = typeof part.thoughtSignature === "string" ? part.thoughtSignature : ""
        if (sig.length === 0) return false
        return !placed.has(sig)
      })
      contents.push({
        role: "model",
        parts: [
          ...thoughtParts,
          ...(text ? [{ text }] : []),
          ...calls.map((call) => {
            const name = call.function?.name
            const functionCall: Record<string, unknown> = {
              name: name ? name : "tool",
              args: toolArgs(call.function?.arguments),
            }
            if (call.id) functionCall.id = call.id
            const signature = thoughtSignatureOf(call)
            const part: Record<string, unknown> = { functionCall }
            if (signature) part.thoughtSignature = signature
            return part
          }),
        ],
      })
      continue
    }
    const structured = partsFromContent(message.content)
    contents.push({
      role: role === "assistant" ? "model" : "user",
      parts: structured && structured.length > 0 ? structured : [{ text }],
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
  const reasoningParts: string[] = []
  const toolCalls: CompletionResult["toolCalls"] = []
  const images: NonNullable<CompletionResult["images"]> = []
  let reasoningSignature: string | undefined
  const candidate = firstCandidate(payload)
  if (typeof candidate?.reasoning_content === "string" && candidate.reasoning_content) {
    reasoningParts.push(candidate.reasoning_content)
  }
  const preserved = candidate?.preservedImages
  if (Array.isArray(preserved)) {
    for (const image of preserved) {
      const record = asRecord(image)
      if (typeof record?.mimeType === "string" && typeof record.data === "string" && record.data) {
        images.push({ mimeType: record.mimeType, data: record.data })
      }
    }
  }
  for (const part of geminiParts(payload)) {
    if (part.antigravityImageReplaced === true) continue
    const thoughtSignature = signatureOf(part)
    if (thoughtSignature) reasoningSignature = thoughtSignature
    if (part.thought === true || part.type === "reasoning") {
      if (typeof part.text === "string" && part.text) reasoningParts.push(part.text)
      continue
    }
    if (typeof part.text === "string" && part.text) textParts.push(part.text)
    const call = asRecord(part.functionCall)
    if (!call) continue
    const name = typeof call.name === "string" && call.name ? call.name : "tool"
    const id = typeof call.id === "string" && call.id ? call.id : name
    const siblingSignature = typeof part.thoughtSignature === "string" && part.thoughtSignature
      ? part.thoughtSignature
      : undefined
    const nestedSignature = typeof call.thoughtSignature === "string" && call.thoughtSignature
      ? call.thoughtSignature
      : undefined
    const callSignature = siblingSignature || nestedSignature || thoughtSignature
    if (callSignature) reasoningSignature = callSignature
    toolCalls.push({
      id,
      name,
      arguments: JSON.stringify(call.args ?? {}),
      ...(callSignature ? { thoughtSignature: callSignature } : {}),
    })
  }
  const upstreamFinishReason = typeof candidate?.finishReason === "string" ? candidate.finishReason : undefined
  const mapped = mapFinishReason(upstreamFinishReason, toolCalls.length > 0)
  const usage = usageFromPayload(payload)
  return {
    model,
    text: textParts.join(""),
    accountId: "",
    toolCalls,
    ...(usage ? { usage } : {}),
    ...(reasoningParts.length > 0 ? { reasoningContent: reasoningParts.join("\n") } : {}),
    ...(reasoningSignature ? { reasoningSignature } : {}),
    ...(mapped.finishReason ? { finishReason: mapped.finishReason } : {}),
    ...(upstreamFinishReason ? { upstreamFinishReason } : {}),
    ...(mapped.safetyMessage ? { safetyMessage: mapped.safetyMessage } : {}),
    ...(images.length > 0 ? { images } : {}),
  }
}

function mapFinishReason(reason: string | undefined, hasToolCall: boolean): {
  finishReason?: CompletionResult["finishReason"]
  safetyMessage?: string
} {
  if (hasToolCall) return { finishReason: "tool_calls" }
  switch (reason) {
    case "SAFETY":
      return { finishReason: "content_filter", safetyMessage: "The model output failed Gemini platform safety checks." }
    case "PROHIBITED_CONTENT":
    case "SPII":
    case "BLOCKLIST":
    case "IMAGE_SAFETY":
      return { finishReason: "content_filter", safetyMessage: "The model output violates Gemini platform policy." }
    case "MAX_TOKENS":
      return { finishReason: "length" }
    case "STOP":
      return { finishReason: "stop" }
    case "RECITATION":
      return { finishReason: "recitation" }
    default:
      return {}
  }
}

function usageFromPayload(payload: unknown): CompletionResult["usage"] | undefined {
  const root = asRecord(payload)
  const response = asRecord(root?.response) ?? root
  const meta = asRecord(response?.usageMetadata)
  if (!meta) return undefined
  const prompt = count(meta.promptTokenCount)
  const cached = count(meta.cachedContentTokenCount)
  const candidates = count(meta.candidatesTokenCount)
  return {
    promptTokens: prompt,
    completionTokens: candidates,
    totalTokens: prompt + candidates,
    cachedTokens: cached,
  }
}

function count(value: unknown): number {
  return typeof value === "number" && Number.isFinite(value) ? value : 0
}

function signatureOf(part: Record<string, unknown>): string | undefined {
  if (typeof part.thoughtSignature === "string" && part.thoughtSignature) return part.thoughtSignature
  const provider = asRecord(part.providerMetadata)
  const anthropic = asRecord(provider?.anthropic)
  return typeof anthropic?.signature === "string" && anthropic.signature ? anthropic.signature : undefined
}

function firstCandidate(payload: unknown): Record<string, unknown> | undefined {
  const root = asRecord(payload)
  const response = asRecord(root?.response) ?? root
  const candidates = response?.candidates
  if (!Array.isArray(candidates)) return undefined
  return asRecord(candidates[0])
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
  if (result.reasoningContent) message.reasoning_content = result.reasoningContent
  if (result.toolCalls.length > 0) {
    message.tool_calls = result.toolCalls.map((call) => ({
      id: call.id,
      type: "function",
      function: { name: call.name, arguments: call.arguments },
      ...(call.thoughtSignature
        ? { extra_content: { google: { thought_signature: call.thoughtSignature } } }
        : {}),
    }))
  }
  const body: Record<string, unknown> = {
    id: `chatcmpl-${Date.now()}`,
    object: "chat.completion",
    created: Math.floor(Date.now() / 1000),
    model: result.model,
    choices: [{
      index: 0,
      message,
      finish_reason: result.finishReason ?? (result.toolCalls.length > 0 ? "tool_calls" : "stop"),
    }],
  }
  if (result.usage) body.usage = openAIUsage(result)
  if (result.images && result.images.length > 0) body.antigravity_images = result.images
  if (result.reasoningSignature) body.antigravity_reasoning_signature = result.reasoningSignature
  if (result.safetyMessage) body.error = { message: result.safetyMessage, type: "content_filter" }
  return body
}

export function openAIChunk(result: CompletionResult, done: boolean): Record<string, unknown> {
  const chunk: Record<string, unknown> = {
    id: `chatcmpl-${Date.now()}`,
    object: "chat.completion.chunk",
    created: Math.floor(Date.now() / 1000),
    model: result.model,
    choices: [{
      index: 0,
      delta: done ? {} : {
        role: "assistant",
        ...(result.text ? { content: result.text } : {}),
        ...(result.reasoningContent ? { reasoning_content: result.reasoningContent } : {}),
      },
      finish_reason: done ? (result.finishReason ?? (result.toolCalls.length > 0 ? "tool_calls" : "stop")) : null,
    }],
  }
  if (done && result.usage) chunk.usage = openAIUsage(result)
  return chunk
}

function openAIUsage(result: CompletionResult): Record<string, unknown> {
  const usage = result.usage
  if (!usage) return {}
  return {
    prompt_tokens: usage.promptTokens,
    completion_tokens: usage.completionTokens,
    total_tokens: usage.totalTokens,
    prompt_tokens_details: { cached_tokens: usage.cachedTokens },
  }
}

