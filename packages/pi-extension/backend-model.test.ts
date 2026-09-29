import { describe, expect, it } from "vitest";
import { resolveBackendModelId } from "./stream";

describe("backend model resolution", () => {
  it("adds the tier suffix gemini flash models require", () => {
    expect(resolveBackendModelId("antigravity-gemini-3.8-flash")).toMatch(/^gemini-3\.8-flash-(low|medium|high)$/);
    expect(resolveBackendModelId("antigravity-gemini-3.7-flash")).toMatch(/^gemini-3\.7-flash-(low|medium|high)$/);
    expect(resolveBackendModelId("antigravity-gemini-3.6-flash")).toMatch(/^gemini-3\.6-flash-(low|medium|high)$/);
  });

  it("never emits the bare name the backend rejects with 404", () => {
    expect(resolveBackendModelId("antigravity-gemini-3.8-flash")).not.toBe("gemini-3.8-flash");
    expect(resolveBackendModelId("antigravity-gemini-3.7-flash")).not.toBe("gemini-3.7-flash");
  });

  it("keeps the provided thinking level", () => {
    expect(resolveBackendModelId("antigravity-gemini-3.8-flash", "high")).toBe("gemini-3.8-flash-high");
  });

  it("leaves Claude models on their backend names", () => {
    expect(resolveBackendModelId("antigravity-claude-sonnet-4-6")).toBe("claude-sonnet-4-6");
    expect(resolveBackendModelId("antigravity-claude-opus-4-6-thinking")).toBe("claude-opus-4-6-thinking");
  });
});