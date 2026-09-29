import { describe, expect, it } from "vitest";
import { cleanJSONSchemaForAntigravity } from "./request-helpers";

describe("cleanJSONSchemaForAntigravity keyword stripping", () => {
  it("removes typebox/senpi-only keywords that the backend rejects", () => {
    const cleaned = cleanJSONSchemaForAntigravity({
      type: "object",
      properties: {
        command: { type: "string", optional: true, nullable: true, discriminator: "kind" },
      },
    });
    expect(cleaned.properties.command).not.toHaveProperty("optional");
    expect(cleaned.properties.command).not.toHaveProperty("nullable");
    expect(cleaned.properties.command).not.toHaveProperty("discriminator");
  });

  it("still removes const and additionalProperties from an object schema", () => {
    const cleaned = cleanJSONSchemaForAntigravity({
      type: "object",
      properties: { mode: { type: "string", const: "fast" } },
      additionalProperties: false,
    });
    expect(cleaned.properties.mode).not.toHaveProperty("const");
    expect(cleaned).not.toHaveProperty("additionalProperties");
  });

  it("converts a nested $ref into a description hint instead of emitting it", () => {
    const cleaned = cleanJSONSchemaForAntigravity({
      type: "object",
      properties: { thing: { $ref: "#/definitions/thing" } },
    });
    expect(cleaned.properties.thing).not.toHaveProperty("$ref");
  });

  it("keeps a property literally named optional", () => {
    const cleaned = cleanJSONSchemaForAntigravity({
      type: "object",
      properties: { optional: { type: "boolean" } },
    });
    expect(cleaned.properties).toHaveProperty("optional");
  });
});