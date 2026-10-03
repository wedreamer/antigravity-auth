import { describe, expect, it } from "vitest"

import { toGeminiBody } from "./openai.ts"

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
        { functionCall: { name: "cbeta_search", args: { q: "x" } } },
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
      parts: [{ functionCall: { name: "cbeta_search", args: {} } }],
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
        { functionCall: { name: "missing", args: {} } },
        { functionCall: { name: "bad", args: {} } },
        { functionCall: { name: "list", args: {} } },
      ],
    }])
  })

  it("uses tool as the functionResponse name when the tool message has no name", () => {
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
})
