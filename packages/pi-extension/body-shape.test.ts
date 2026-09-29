import { describe, expect, it } from "vitest";
import { randomUUID } from "node:crypto";
import { buildWrappedBody } from "./gemini-shape";

describe("wrapped body shape", () => {
  it("matches the payload the live backend accepted", () => {
    const sessionId = randomUUID();
    const built = buildWrappedBody({
      project: "project-placeholder",
      model: "gemini-3.8-flash-tiered",
      contents: [{ role: "user", parts: [{ text: "Reply with exactly AGY_NATIVE_OK" }] }],
      sessionId,
    });

    expect(Object.keys(built).sort()).toEqual(["model", "project", "request", "requestId", "requestType", "userAgent"]);
    expect(built.requestType).toBe("agent");
    expect(built.userAgent).toBe("antigravity");
    expect(String(built.requestId)).toMatch(/^agent-/);
    expect(built.project).toBe("project-placeholder");
    expect(built.model).toBe("gemini-3.8-flash-tiered");

    const request = built.request as Record<string, unknown>;
    expect(Object.keys(request).sort()).toEqual(["contents", "sessionId", "systemInstruction"]);
    expect(request.sessionId).toBe(sessionId);
    const contents = request.contents as Record<string, unknown>[];
    expect(contents[0]).toEqual({ role: "user", parts: [{ text: "Reply with exactly AGY_NATIVE_OK" }] });
    const systemInstruction = request.systemInstruction as Record<string, unknown>;
    expect(systemInstruction.role).toBe("user");
    expect(Array.isArray(systemInstruction.parts)).toBe(true);
  });
});
