import { describe, expect, it } from "vitest";
import { isClaudeModel, isClaudeThinkingModel } from "../../src/plugin/transform/claude";
import { resolveBackendModelId } from "./stream";

describe("claude path resolution", () => {
  it("recognizes the backend names the catalog resolves to", () => {
    expect(isClaudeModel(resolveBackendModelId("antigravity-claude-sonnet-4-6"))).toBe(true);
    expect(isClaudeModel(resolveBackendModelId("antigravity-claude-opus-4-6-thinking"))).toBe(true);
  });

  it("recognizes the thinking variant", () => {
    expect(isClaudeThinkingModel(resolveBackendModelId("antigravity-claude-opus-4-6-thinking"))).toBe(true);
    expect(isClaudeThinkingModel(resolveBackendModelId("antigravity-claude-sonnet-4-6"))).toBe(false);
  });
});