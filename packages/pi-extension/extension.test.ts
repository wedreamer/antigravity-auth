import { describe, expect, it, vi } from "vitest";
import { buildModelEntries } from "./index";
import { resolveBackendModelId } from "./stream";
import { resolveProjectId } from "./project-id";
import { getSharedModel, listSharedModels, readSharedRefresh, writeSharedRefresh } from "../../src/shared/registry";
import { selectableAccounts } from "../../src/shared/pool";
import { buildWrappedBody, composeSystemInstruction, messagesToContents, toolsToGeminiDeclarations } from "./gemini-shape";
import { parseSseDataLine, extractText, extractFunctionCalls, runTurn } from "./stream";

describe("model catalog", () => {
  it("exposes the Gemini and Claude families the backend serves", () => {
    const ids = listSharedModels().map((model) => model.id);
    expect(ids).toContain("antigravity-gemini-3.8-flash");
    expect(ids).toContain("antigravity-gemini-3.1-pro");
    expect(ids).toContain("antigravity-claude-sonnet-4-6");
    expect(ids).toContain("antigravity-claude-opus-4-6-thinking");
  });

  it("rejects any catalogue model whose id the backend would not accept", () => {
    const ids = buildModelEntries().map((model) => model.id);
    expect(ids.length).toBeGreaterThan(0);
    for (const id of ids) {
      expect(id.startsWith("antigravity-")).toBe(true);
      expect(id).not.toMatch(/[A-Z\s]/);
    }
  });

  it("emits only modalities the provider contract allows on the wire entry", () => {
    const entries = buildModelEntries();
    expect(entries.length).toBeGreaterThan(0);
    for (const entry of entries) {
      expect(entry.input.length).toBeGreaterThan(0);
      for (const modality of entry.input) {
        expect(["text", "image"]).toContain(modality);
      }
    }
    // The source catalogue declares a pdf modality; it must not survive the projection, because a
    // single unsupported value silently invalidates the whole provider config on the native host.
    const withPdf = listSharedModels().filter((model) => model.id.startsWith("antigravity-"));
    for (const model of withPdf) {
      expect(model.input).not.toContain("pdf" as never);
    }
  });

  it("resolves every catalogued model to a backend name the API serves", () => {
    for (const model of buildModelEntries()) {
      const backend = resolveBackendModelId(model.id);
      expect(backend.length).toBeGreaterThan(0);
      if (/gemini-3\.[5-8]-flash/.test(backend)) {
        expect(backend).toMatch(/-(low|medium|high)$/);
      }
      expect(backend).not.toMatch(/^antigravity-/);
    }
  });
});

describe("credential shaping", () => {
  it("round-trips the packed refresh string both hosts share", () => {
    const packed = writeSharedRefresh({ refreshToken: "rt-value", projectId: "proj-9" });
    expect(packed).toBe("rt-value|proj-9");
    expect(readSharedRefresh(packed)).toEqual({ refreshToken: "rt-value", projectId: "proj-9", managedProjectId: undefined });
  });

  it("resolves the project id, falling back to the shared default", () => {
    expect(resolveProjectId("rt|proj-7")).toBe("proj-7");
    expect(resolveProjectId("rt|", "rising-fact-p41fc")).toBe("rising-fact-p41fc");
  });
});

describe("pool selection", () => {
  it("keeps only enabled accounts that carry a refresh token", () => {
    const selected = selectableAccounts([
      { refreshToken: "a", enabled: true },
      { refreshToken: "b", enabled: false },
      { refreshToken: "", enabled: true },
    ]);
    expect(selected.map((account) => account.refreshToken)).toEqual(["a"]);
  });

  it("drops an account whose refresh token is present but the account is disabled", () => {
    const selected = selectableAccounts([
      { refreshToken: "only-disabled", enabled: false },
      { refreshToken: "also-disabled" },
    ]);
    expect(selected).toEqual([]);
  });
});

describe("system instruction", () => {
  it("prepends the Antigravity instruction instead of replacing the host prompt", () => {
    const composed = composeSystemInstruction("PROJECT RULES MARKER");
    expect(composed).toContain("PROJECT RULES MARKER");
    expect(composed.indexOf("Antigravity")).toBeLessThan(composed.indexOf("PROJECT RULES MARKER"));
  });

  it("falls back to the Antigravity instruction when the host sends none", () => {
    expect(composeSystemInstruction(undefined)).toContain("Antigravity");
    expect(composeSystemInstruction("   ")).toContain("Antigravity");
  });

  it("carries the host prompt into the wrapped request body", () => {
    const body = buildWrappedBody({
      project: "p",
      model: "gemini-3.8-flash-low",
      contents: [{ role: "user", parts: [{ text: "hi" }] }],
      systemPrompt: "PROJECT RULES MARKER",
      sessionId: "s",
    });
    const request = body.request as Record<string, unknown>;
    const systemInstruction = request.systemInstruction as { parts: { text: string }[] };
    expect(systemInstruction.parts[0]?.text).toContain("PROJECT RULES MARKER");
  });
});

describe("message conversion", () => {
  it("keeps a tool call as a functionCall part instead of dropping the turn", () => {
    const contents = messagesToContents([
      { role: "user", content: [{ type: "text", text: "run it" }] },
      { role: "assistant", content: [{ type: "toolCall", id: "c1", name: "bash", arguments: { command: "ls" } }] },
    ]);
    expect(contents).toHaveLength(2);
    expect(contents[1]).toEqual({
      role: "model",
      parts: [{ functionCall: { name: "bash", args: { command: "ls" } } }],
    });
  });

  it("converts a tool result into a functionResponse carrying the tool name", () => {
    const contents = messagesToContents([
      { role: "toolResult", toolCallId: "c1", toolName: "bash", content: [{ type: "text", text: "file.txt" }], isError: false },
    ]);
    expect(contents[0]?.role).toBe("user");
    const part = contents[0]?.parts[0] as { functionResponse: { name: string; id?: string; response: { content: { text: string }[]; error?: boolean } } };
    expect(part.functionResponse.name).toBe("bash");
    expect(part.functionResponse.id).toBe("c1");
    expect(part.functionResponse.response.content[0]?.text).toBe("file.txt");
    expect(part.functionResponse.response.error).toBeUndefined();
  });

  it("marks a failed tool result so the model can tell it apart from a success", () => {
    const contents = messagesToContents([
      { role: "toolResult", toolCallId: "c2", toolName: "bash", content: [{ type: "text", text: "command failed" }], isError: true },
    ]);
    const part = contents[0]?.parts[0] as { functionResponse: { response: { error?: boolean } } };
    expect(part.functionResponse.response.error).toBe(true);
  });

  it("carries image parts through as inlineData", () => {
    const contents = messagesToContents([
      { role: "user", content: [{ type: "image", data: "AAAA", mimeType: "image/png" }] },
    ]);
    expect(contents[0]?.parts[0]).toEqual({ inlineData: { mimeType: "image/png", data: "AAAA" } });
  });

  it("drops nothing from a multi-turn text conversation", () => {
    const contents = messagesToContents([
      { role: "user", content: "第一轮" },
      { role: "assistant", content: [{ type: "text", text: "第一答" }] },
      { role: "user", content: "第二轮" },
    ]);
    expect(contents.map((entry) => entry.role)).toEqual(["user", "model", "user"]);
  });
});

describe("tool declarations", () => {
  it("cleans unsupported keywords out of parameters", () => {
    const declarations = toolsToGeminiDeclarations([
      {
        name: "bash",
        description: "run a command",
        parameters: {
          type: "object",
          properties: { command: { type: "string", const: "ls", optional: true } },
          required: ["command"],
        },
      },
    ]);
    const parameters = declarations[0]?.functionDeclarations[0]?.parameters as {
      properties: Record<string, Record<string, unknown>>;
    };
    expect(parameters.properties.command).not.toHaveProperty("const");
    expect(parameters.properties.command).not.toHaveProperty("optional");
  });
});

describe("SSE translation", () => {
  it("parses data lines and ignores non-data payloads", () => {
    expect(parseSseDataLine("data: {\"a\":1}")).toEqual({ a: 1 });
    expect(parseSseDataLine("event: ping")).toBeUndefined();
    expect(parseSseDataLine("data: [DONE]")).toBeUndefined();
    expect(parseSseDataLine("data: not json")).toBeUndefined();
  });

  it("reads text and function calls out of a chunk", () => {
    const chunk = {
      response: {
        candidates: [
          { content: { parts: [{ text: "AGY_NATIVE" }, { functionCall: { name: "bash", args: { command: "ls" } } }] } },
        ],
      },
    };
    expect(extractText(chunk)).toBe("AGY_NATIVE");
    expect(extractFunctionCalls(chunk)).toEqual([{ name: "bash", args: { command: "ls" } }]);
  });
});

describe("runTurn event contract", () => {
  function sseResponse(chunks: unknown[]): Response {
    const body = chunks.map((chunk) => `data: ${JSON.stringify(chunk)}\n\n`).join("");
    return new Response(body, { status: 200, headers: { "Content-Type": "text/event-stream" } });
  }

  it("emits start, text deltas, and a single done carrying the message", async () => {
    const events: Record<string, unknown>[] = [];
    const fetchImpl = vi.fn(async () =>
      sseResponse([
        { response: { candidates: [{ content: { parts: [{ text: "AGY_" }] } }] } },
        { response: { candidates: [{ content: { parts: [{ text: "NATIVE_OK" }] } }] } },
      ]),
    );
    await runTurn(
      {
        modelId: "gemini-3.8-flash-low",
        provider: "google-antigravity",
        api: "antigravity-code-assist",
        contents: [{ role: "user", parts: [{ text: "go" }] }],
        accessToken: "token",
        storedRefresh: "rt|proj",
        fetchImpl: fetchImpl as unknown as typeof fetch,
      },
      { push: (event) => events.push(event), end: () => {}, fail: () => {} },
    );

    expect(events[0]?.type).toBe("start");
    expect(events.filter((event) => event.type === "text_delta")).toHaveLength(2);
    expect(events.filter((event) => event.type === "done")).toHaveLength(1);
    const done = events.find((event) => event.type === "done") as { message: { content: { text: string }[] } };
    expect(done.message.content[0]?.text).toBe("AGY_NATIVE_OK");
    expect(events.filter((event) => event.type === "error")).toHaveLength(0);
  });

  it("closes the text block before starting a tool call", async () => {
    const events: Record<string, unknown>[] = [];
    const fetchImpl = vi.fn(async () =>
      sseResponse([
        { response: { candidates: [{ content: { parts: [{ text: "thinking out loud" }, { functionCall: { name: "eval", args: { code: "1" } } }] } }] } },
      ]),
    );
    await runTurn(
      {
        modelId: "gemini-3.8-flash-low",
        provider: "google-antigravity",
        api: "antigravity-code-assist",
        contents: [],
        accessToken: "token",
        storedRefresh: "rt|proj",
        fetchImpl: fetchImpl as unknown as typeof fetch,
      },
      { push: (event) => events.push(event), end: () => {}, fail: () => {} },
    );

    const order = events.map((event) => event.type);
    const textEnd = order.indexOf("text_end");
    const toolStart = order.indexOf("toolcall_start");
    expect(textEnd).toBeGreaterThanOrEqual(0);
    expect(toolStart).toBeGreaterThanOrEqual(0);
    expect(textEnd).toBeLessThan(toolStart);
  });

  it("ends the stream with an error event when the backend refuses", async () => {
    const events: Record<string, unknown>[] = [];
    const failures: unknown[] = [];
    const fetchImpl = vi.fn(async () => new Response("nope", { status: 400 }));
    await runTurn(
      {
        modelId: "gemini-3.8-flash-low",
        provider: "google-antigravity",
        api: "antigravity-code-assist",
        contents: [],
        accessToken: "token",
        storedRefresh: "rt|proj",
        fetchImpl: fetchImpl as unknown as typeof fetch,
      },
      { push: (event) => events.push(event), end: () => {}, fail: (error) => failures.push(error) },
    );

    expect(events.filter((event) => event.type === "error")).toHaveLength(1);
    expect(failures).toHaveLength(1);
    expect(events.filter((event) => event.type === "done")).toHaveLength(0);
  });

  it("reports an abort as an error event, never as a clean done", async () => {
    const events: Record<string, unknown>[] = [];
    const controller = new AbortController();
    controller.abort();
    const fetchImpl = vi.fn(async () => {
      throw new Error("aborted");
    });
    await runTurn(
      {
        modelId: "gemini-3.8-flash-low",
        provider: "google-antigravity",
        api: "antigravity-code-assist",
        contents: [],
        accessToken: "token",
        storedRefresh: "rt|proj",
        fetchImpl: fetchImpl as unknown as typeof fetch,
        signal: controller.signal,
      },
      { push: (event) => events.push(event), end: () => {}, fail: () => {} },
    );

    const terminal = events.find((event) => event.type === "error" || event.type === "done");
    expect(terminal?.type).toBe("error");
    expect(terminal?.reason).toBe("aborted");
  });
});

describe("oauth refresh failure path", () => {
  it("raises a typed error carrying the HTTP status instead of crashing", async () => {
    const { refreshAntigravity } = await import("./oauth");
    const fetchImpl = vi.fn(async () => new Response(JSON.stringify({ error: "invalid_grant" }), { status: 400 }));
    await expect(
      refreshAntigravity({ refresh: "rt|proj", access: "a", expires: Date.now() }, undefined, fetchImpl as unknown as typeof fetch),
    ).rejects.toThrow(/Antigravity token refresh failed: 400/);
  });

  it("rejects a stored credential with no refresh token", async () => {
    const { refreshAntigravity } = await import("./oauth");
    const fetchImpl = vi.fn();
    await expect(
      refreshAntigravity({ refresh: "", access: "a", expires: Date.now() }, undefined, fetchImpl as unknown as typeof fetch),
    ).rejects.toThrow(/missing its refresh token/);
    expect(fetchImpl).not.toHaveBeenCalled();
  });
});
