import { describe, expect, it } from "vitest"

import { extractCompletion, openAIChunk, openAICompletion, toGeminiBody } from "./openai.ts"

const model = "gemini-3.8-flash"

describe("toGeminiBody", () => {
  it("maps an assistant tool call and the following tool result", () => {
    const body = toGeminiBody({
      messages: [
        {
          role: "assistant",
          content: "",
          tool_calls: [{
            id: "call_1",
            type: "function",
            function: { name: "cbeta_search", arguments: "{\"q\":\"真性有为空\"}" },
          }],
        },
        { role: "tool", name: "cbeta_search", content: "passage" },
      ],
      tools: [{
        type: "function",
        function: {
          name: "cbeta_search",
          description: "search cbeta",
          parameters: { type: "object" },
        },
      }],
    }, model)

    expect(body.contents).toEqual([
      {
        role: "model",
        parts: [{
          functionCall: {
            id: "call_1",
            name: "cbeta_search",
            args: { q: "真性有为空" },
          },
        }],
      },
      {
        role: "user",
        parts: [{
          functionResponse: {
            name: "cbeta_search",
            response: { result: "passage" },
          },
        }],
      },
    ])
    expect(body.tools).toEqual([{
      functionDeclarations: [{
        name: "cbeta_search",
        description: "search cbeta",
        parameters: { type: "object" },
      }],
    }])
  })

  it("keeps non-empty assistant text ahead of functionCall parts", () => {
    const body = toGeminiBody({
      messages: [{
        role: "assistant",
        content: "looking up",
        tool_calls: [{
          id: "call_1",
          type: "function",
          function: { name: "cbeta_search", arguments: "{\"q\":\"x\"}" },
        }],
      }],
    }, model)

    expect(body.contents).toEqual([{
      role: "model",
      parts: [
        { text: "looking up" },
        { functionCall: { id: "call_1", name: "cbeta_search", args: { q: "x" } } },
      ],
    }])
  })

  it("maps a model message with tool_calls to role model", () => {
    const body = toGeminiBody({
      messages: [{
        role: "model",
        tool_calls: [{
          id: "call_1",
          type: "function",
          function: { name: "cbeta_search", arguments: "{}" },
        }],
      }],
    }, model)

    expect(body.contents).toEqual([{
      role: "model",
      parts: [{ functionCall: { id: "call_1", name: "cbeta_search", args: {} } }],
    }])
  })

  it("uses an empty object when arguments are missing or not a JSON object", () => {
    const body = toGeminiBody({
      messages: [{
        role: "assistant",
        tool_calls: [
          { id: "call_missing", type: "function", function: { name: "missing" } },
          { id: "call_bad", type: "function", function: { name: "bad", arguments: "{" } },
          { id: "call_list", type: "function", function: { name: "list", arguments: "[1]" } },
        ],
      }],
    }, model)

    expect(body.contents).toEqual([{
      role: "model",
      parts: [
        { functionCall: { id: "call_missing", name: "missing", args: {} } },
        { functionCall: { id: "call_bad", name: "bad", args: {} } },
        { functionCall: { id: "call_list", name: "list", args: {} } },
      ],
    }])
  })

  it("keeps tool call ids and thought signatures on the same function call", () => {
    const body = toGeminiBody({
      messages: [
        {
          role: "assistant",
          tool_calls: [
            {
              id: "a",
              type: "function",
              function: { name: "cbeta_search", arguments: "{}" },
              extra_content: { google: { thought_signature: "SIG" } },
            },
            {
              id: "b",
              type: "function",
              function: { name: "cbeta_search", arguments: "{}" },
            },
          ],
        },
        { role: "tool", tool_call_id: "a", name: "cbeta_search", content: "ok" },
      ],
    }, model)
    const contents = body.contents as Array<{
      parts: Array<{
        functionCall?: Record<string, unknown>
        functionResponse?: Record<string, unknown>
        thoughtSignature?: string
      }>
    }>
    expect(contents[0]?.parts[0]).toEqual({
      functionCall: { id: "a", name: "cbeta_search", args: {} },
      thoughtSignature: "SIG",
    })
    expect(contents[0]?.parts[0]?.functionCall).not.toHaveProperty("thoughtSignature")
    expect(contents[0]?.parts[1]?.functionCall).toMatchObject({ id: "b", name: "cbeta_search" })
    expect(contents[1]?.parts[0]?.functionResponse).toMatchObject({ id: "a", name: "cbeta_search" })
  })

  it("translates an image data URL to inlineData", () => {
    const body = toGeminiBody({
      messages: [{
        role: "user",
        content: [
          { type: "text", text: "看" },
          { type: "image_url", image_url: { url: "data:image/png;base64,aGk=" } },
        ],
      }],
    }, model)
    expect(body.contents).toEqual([{
      role: "user",
      parts: [
        { text: "看" },
        { inlineData: { mimeType: "image/png", data: "aGk=" } },
      ],
    }])
  })

  it("uses tool as the functionResponse name only when no name and no matching call exist", () => {
    const body = toGeminiBody({
      messages: [{ role: "tool", content: "passage" }],
    }, model)

    expect(body.contents).toEqual([{
      role: "user",
      parts: [{
        functionResponse: {
          name: "tool",
          response: { result: "passage" },
        },
      }],
    }])
  })

  it("resolves functionResponse.name from the matching tool call when the tool message omits name", () => {
    const body = toGeminiBody({
      messages: [
        {
          role: "assistant",
          tool_calls: [{
            id: "call_1767445",
            type: "function",
            function: { name: "cbeta_search", arguments: "{}" },
          }],
        },
        { role: "tool", tool_call_id: "call_1767445", content: "hits" },
      ],
    }, model)
    const contents = body.contents as Array<{
      parts: Array<{ functionResponse?: { name?: string, id?: string } }>
    }>
    expect(contents[1]?.parts[0]?.functionResponse).toMatchObject({
      name: "cbeta_search",
      id: "call_1767445",
    })
  })

  it("keeps an explicit tool message name over the matched call name", () => {
    const body = toGeminiBody({
      messages: [
        {
          role: "assistant",
          tool_calls: [{
            id: "call_1767445",
            type: "function",
            function: { name: "cbeta_search", arguments: "{}" },
          }],
        },
        { role: "tool", tool_call_id: "call_1767445", name: "explicit_name", content: "hits" },
      ],
    }, model)
    const contents = body.contents as Array<{
      parts: Array<{ functionResponse?: { name?: string } }>
    }>
    expect(contents[1]?.parts[0]?.functionResponse?.name).toBe("explicit_name")
  })

  it("does not emit an empty thought part that duplicates the functionCall signature", () => {
    const body = toGeminiBody({
      messages: [{
        role: "assistant",
        content: [{ type: "think", think: "", encrypted: "SIG" }],
        tool_calls: [{
          id: "call_sig",
          type: "function",
          function: { name: "cbeta_search", arguments: "{}" },
          extra_content: { google: { thought_signature: "SIG" } },
        }],
      }],
    }, model)
    const contents = body.contents as Array<{
      parts: Array<{
        thought?: boolean
        text?: string
        functionCall?: Record<string, unknown>
        thoughtSignature?: string
      }>
    }>
    expect(contents[0]?.parts.some((part) => part.thought === true)).toBe(false)
    expect(contents[0]?.parts[0]?.functionCall).not.toHaveProperty("thoughtSignature")
    expect(contents[0]?.parts[0]?.thoughtSignature).toBe("SIG")

    const kept = toGeminiBody({
      messages: [{
        role: "assistant",
        content: [{ type: "think", think: "kept", encrypted: "SIG" }],
        tool_calls: [{
          id: "call_sig",
          type: "function",
          function: { name: "cbeta_search", arguments: "{}" },
          extra_content: { google: { thought_signature: "SIG" } },
        }],
      }],
    }, model)
    const keptContents = kept.contents as Array<{
      parts: Array<{ thought?: boolean, text?: string }>
    }>
    expect(keptContents[0]?.parts.some((part) => part.thought === true && part.text === "kept")).toBe(true)
  })
})

const SIG = "sig_0123456789abcdef"

describe("issue 6 response fields", () => {
  const payload = {
    candidates: [{
      finishReason: "STOP",
      content: {
        parts: [
          {
            thought: true,
            text: "why",
            providerMetadata: { anthropic: { signature: SIG } },
          },
          { text: "answer" },
          { functionCall: { id: "fc_1", name: "cbeta_search", args: {} }, thoughtSignature: SIG },
        ],
      },
    }],
    usageMetadata: {
      promptTokenCount: 100,
      cachedContentTokenCount: 40,
      candidatesTokenCount: 7,
      thoughtsTokenCount: 3,
    },
  }

  it("maps usage without adding thought tokens", () => {
    const completion = openAICompletion({ ...extractCompletion(payload, model), accountId: "a" })
    expect(completion.usage).toEqual({
      prompt_tokens: 100,
      completion_tokens: 7,
      total_tokens: 107,
      prompt_tokens_details: { cached_tokens: 40 },
    })
    const message = (completion.choices as Array<{ message: { content: string; reasoning_content: string; tool_calls: Array<{ id: string; extra_content: { google: { thought_signature: string } } }> } }>)[0]?.message
    expect(message?.content).toBe("answer")
    expect(message?.content).not.toContain("why")
    expect(message?.reasoning_content).toBe("why")
    expect(message?.tool_calls[0]?.id).toBe("fc_1")
    expect(message?.tool_calls[0]?.extra_content.google.thought_signature).toBe(SIG)
  })

  it("keeps same-name tool ids and does not invent call_N", () => {
    const completion = extractCompletion({
      candidates: [{
        content: {
          parts: [
            { functionCall: { id: "a", name: "cbeta_search", args: {} } },
            { functionCall: { id: "b", name: "cbeta_search", args: {} } },
            { functionCall: { name: "cbeta_search", args: {} } },
          ],
        },
      }],
    }, model)
    expect(completion.toolCalls.map((call) => call.id)).toEqual(["a", "b", "cbeta_search"])
  })

  it("maps safety and max tokens finish reasons", () => {
    const safety = extractCompletion({ candidates: [{ finishReason: "SAFETY", content: { parts: [] } }] }, model)
    expect(openAICompletion({ ...safety, accountId: "a" }).choices).toEqual([
      expect.objectContaining({ finish_reason: "content_filter" }),
    ])
    expect(safety.safetyMessage).toBe("The model output failed Gemini platform safety checks.")
    const limited = extractCompletion({
      candidates: [{ finishReason: "MAX_TOKENS", content: { parts: [{ text: "partial" }] } }],
    }, model)
    expect(limited.finishReason).toBe("length")
    const tools = extractCompletion({
      candidates: [{
        finishReason: "STOP",
        content: { parts: [{ functionCall: { id: "fc_1", name: "cbeta_search", args: {} } }] },
      }],
    }, model)
    expect(tools.finishReason).toBe("tool_calls")
    const recited = extractCompletion({
      candidates: [{ finishReason: "RECITATION", content: { parts: [{ text: "quote" }] } }],
    }, model)
    expect(recited.finishReason).not.toBe("stop")
    expect(recited.finishReason).toBe("recitation")
  })

  it("puts usage and tool_calls finish reason on the final chunk", () => {
    const result = extractCompletion(payload, model)
    const chunk = openAIChunk({ ...result, accountId: "a" }, true)
    expect((chunk.choices as Array<{ finish_reason: string }>)[0]?.finish_reason).toBe("tool_calls")
    expect(chunk.usage).toMatchObject({ prompt_tokens: 100, completion_tokens: 7 })
  })
})
