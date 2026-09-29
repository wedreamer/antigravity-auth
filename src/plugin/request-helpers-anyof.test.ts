import { describe, expect, it } from "vitest";
import { cleanJSONSchemaForAntigravity } from "./request-helpers";

describe("cleanJSONSchemaForAntigravity preserves union-constrained tool arguments", () => {
  it("keeps the tool's own top-level properties when the schema is anyOf-topped", () => {
    const schema = {
      type: "object",
      properties: {
        action: { enum: ["run", "list"] },
        language: { type: "string" },
        code: { type: "string" },
        summary: { type: "string" },
      },
      required: ["action"],
      anyOf: [{ required: ["language", "code"] }],
    };
    const cleaned = cleanJSONSchemaForAntigravity(schema) as { properties?: Record<string, unknown> };
    const keys = Object.keys(cleaned.properties ?? {});
    expect(keys).toContain("language");
    expect(keys).toContain("code");
    expect(keys).toContain("summary");
    expect(keys).toContain("action");
    expect(cleaned).not.toHaveProperty("anyOf");
  });

  it("keeps required entries from both the parent and the selected branch", () => {
    const schema = {
      type: "object",
      properties: { action: { enum: ["run", "list"] }, language: { type: "string" }, code: { type: "string" } },
      required: ["action"],
      anyOf: [{ required: ["language", "code"] }],
    };
    const cleaned = cleanJSONSchemaForAntigravity(schema) as { required?: string[] };
    expect(cleaned.required).toContain("action");
    expect(cleaned.required).toContain("language");
    expect(cleaned.required).toContain("code");
  });

  it("still merges a pure enum union into a single enum", () => {
    const cleaned = cleanJSONSchemaForAntigravity({ anyOf: [{ const: "text" }, { const: "json" }] }) as {
      type?: string;
      enum?: string[];
    };
    expect(cleaned.type).toBe("string");
    expect(cleaned.enum).toEqual(["text", "json"]);
  });
});
