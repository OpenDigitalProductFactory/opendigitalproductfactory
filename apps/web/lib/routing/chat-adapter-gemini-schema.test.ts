// BI-3907AF35 — a union `type` must not take down every coworker turn.

import { describe, expect, it } from "vitest";

import { __testing } from "./chat-adapter";

const { sanitizeGeminiSchemaNode, toGeminiFunctionDeclarations } = __testing;

function sanitize(schema: unknown) {
  return sanitizeGeminiSchemaNode(schema) as Record<string, unknown>;
}

describe("Gemini schema sanitisation", () => {
  // The live failure: gemini rejected the whole request with
  // "Proto field is not repeating, cannot start list" at properties[9].value,
  // so the coworker could not run at all — not merely that one tool.
  it("collapses a nullable union to a scalar type plus nullable", () => {
    const out = sanitize({
      type: "object",
      properties: { value: { type: ["string", "null"] } },
    });
    const value = (out.properties as Record<string, Record<string, unknown>>).value;
    expect(value.type).toBe("string");
    expect(value.nullable).toBe(true);
  });

  it("collapses a union with no null to its first member", () => {
    const out = sanitize({ type: ["string", "number"] });
    expect(out.type).toBe("string");
    expect(out.nullable).toBeUndefined();
  });

  it("leaves an ordinary scalar type untouched", () => {
    const out = sanitize({ type: "string" });
    expect(out.type).toBe("string");
    expect(out.nullable).toBeUndefined();
  });

  // A property legitimately named "type" is a property NAME, not a schema
  // keyword, and must survive.
  it("does not mistake a property named type for the type keyword", () => {
    const out = sanitize({
      type: "object",
      properties: { type: { type: ["string", "null"] } },
    });
    const prop = (out.properties as Record<string, Record<string, unknown>>).type;
    expect(prop.type).toBe("string");
    expect(prop.nullable).toBe(true);
  });

  it("carries the collapse through a whole function declaration", () => {
    const [declaration] = toGeminiFunctionDeclarations([
      {
        type: "function",
        function: {
          name: "record_thing",
          description: "d",
          parameters: { type: "object", properties: { value: { type: ["string", "null"] } } },
        },
      },
    ]) as Array<Record<string, unknown>>;
    const params = declaration!.parameters as Record<string, unknown>;
    const value = (params.properties as Record<string, Record<string, unknown>>).value;
    expect(value.type).toBe("string");
    expect(Array.isArray(value.type)).toBe(false);
  });
});
