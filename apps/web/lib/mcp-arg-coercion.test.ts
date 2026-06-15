import { describe, it, expect } from "vitest";
import { coerceMcpToolArgs } from "./mcp-arg-coercion";

// A faithful subset of the real principle_decide inputSchema: `options` is an
// array of objects, each with a nested `features` object map; `ringScope` is a
// string array; `callingPopulation`/`context` are plain strings. Kept inline so
// this unit test is hermetic. The governed-execute test exercises the *real*
// registry schema end-to-end. (BI-16A80690)
const PRINCIPLE_DECIDE_SCHEMA: Record<string, unknown> = {
  type: "object",
  properties: {
    context: { type: "string" },
    options: {
      type: "array",
      items: {
        type: "object",
        properties: {
          id: { type: "string" },
          description: { type: "string" },
          features: {
            type: "object",
            additionalProperties: { type: "number" },
          },
        },
        required: ["id", "description"],
      },
    },
    callingPopulation: {
      type: "string",
      enum: ["in_platform_coworker", "external_coding_agent", "human"],
    },
    ringScope: { type: "array", items: { type: "string" } },
  },
  required: ["context", "options", "callingPopulation"],
};

const STRUCTURED_OPTIONS = [
  { id: "a", description: "A" },
  { id: "b", description: "B" },
];

describe("coerceMcpToolArgs — principle_decide shapes (BI-16A80690)", () => {
  it("coerces options sent as a JSON string into a native array (mode 2)", () => {
    const out = coerceMcpToolArgs(
      {
        context: "x",
        callingPopulation: "external_coding_agent",
        options: JSON.stringify(STRUCTURED_OPTIONS),
      },
      PRINCIPLE_DECIDE_SCHEMA,
    );

    expect(Array.isArray(out.options)).toBe(true);
    expect(out.options).toEqual(STRUCTURED_OPTIONS);
    // scalar fields are left exactly as sent
    expect(out.callingPopulation).toBe("external_coding_agent");
    expect(out.context).toBe("x");
  });

  it("leaves already-structured options unchanged (idempotent — structured shape)", () => {
    const out = coerceMcpToolArgs(
      {
        context: "x",
        callingPopulation: "human",
        options: STRUCTURED_OPTIONS,
      },
      PRINCIPLE_DECIDE_SCHEMA,
    );

    expect(out.options).toEqual(STRUCTURED_OPTIONS);
    expect(out.callingPopulation).toBe("human");
  });

  it("parses a whole arguments object sent as a single JSON string (mode 1)", () => {
    const out = coerceMcpToolArgs(
      JSON.stringify({
        context: "x",
        callingPopulation: "external_coding_agent",
        options: STRUCTURED_OPTIONS,
      }),
      PRINCIPLE_DECIDE_SCHEMA,
    );

    expect(out.callingPopulation).toBe("external_coding_agent");
    expect(Array.isArray(out.options)).toBe(true);
    expect(out.options).toEqual(STRUCTURED_OPTIONS);
  });

  it("handles mode 1 + mode 2 together (whole object string with a stringified inner array)", () => {
    const out = coerceMcpToolArgs(
      JSON.stringify({
        context: "x",
        callingPopulation: "external_coding_agent",
        options: JSON.stringify(STRUCTURED_OPTIONS),
      }),
      PRINCIPLE_DECIDE_SCHEMA,
    );

    expect(Array.isArray(out.options)).toBe(true);
    expect(out.options).toEqual(STRUCTURED_OPTIONS);
  });

  it("coerces ringScope sent as a JSON string into an array", () => {
    const out = coerceMcpToolArgs(
      {
        context: "x",
        callingPopulation: "human",
        options: STRUCTURED_OPTIONS,
        ringScope: JSON.stringify(["ring-1-coworker", "universal-ring"]),
      },
      PRINCIPLE_DECIDE_SCHEMA,
    );

    expect(out.ringScope).toEqual(["ring-1-coworker", "universal-ring"]);
  });

  it("re-hydrates a per-option features map sent as a string (nested recursion)", () => {
    const out = coerceMcpToolArgs(
      {
        context: "x",
        callingPopulation: "human",
        options: [
          { id: "a", description: "A", features: JSON.stringify({ x: 0.5 }) },
          { id: "b", description: "B", features: { y: 0.25 } },
        ],
      },
      PRINCIPLE_DECIDE_SCHEMA,
    );

    const opts = out.options as Array<Record<string, unknown>>;
    expect(opts[0].features).toEqual({ x: 0.5 });
    expect(opts[1].features).toEqual({ y: 0.25 });
  });
});

describe("coerceMcpToolArgs — safety: no false positives", () => {
  it("does not parse a string-typed param even when it looks like JSON", () => {
    const out = coerceMcpToolArgs(
      {
        context: '{"looks":"like json but is a string param"}',
        callingPopulation: "human",
        options: STRUCTURED_OPTIONS,
      },
      PRINCIPLE_DECIDE_SCHEMA,
    );

    // `context` is type:string in the schema — must stay the literal string.
    expect(typeof out.context).toBe("string");
    expect(out.context).toBe('{"looks":"like json but is a string param"}');
  });

  it("never parses a string-typed `content` param (content-bearing tool safety)", () => {
    const writeFileSchema: Record<string, unknown> = {
      type: "object",
      properties: {
        path: { type: "string" },
        content: { type: "string" },
      },
      required: ["path", "content"],
    };
    const jsonFileContent = '{"a":1,"b":[2,3]}';

    const out = coerceMcpToolArgs(
      { path: "config.json", content: jsonFileContent },
      writeFileSchema,
    );

    // A blanket "parse anything that looks like JSON" would corrupt this into
    // an object; schema-driven coercion keeps it the exact string to write.
    expect(typeof out.content).toBe("string");
    expect(out.content).toBe(jsonFileContent);
  });

  it("leaves a malformed JSON string for a structured param as the original string", () => {
    const out = coerceMcpToolArgs(
      {
        context: "x",
        callingPopulation: "human",
        options: "[ this is not valid json",
      },
      PRINCIPLE_DECIDE_SCHEMA,
    );

    // Left untouched so the handler's strict check emits a clear error instead
    // of us masking malformed input.
    expect(typeof out.options).toBe("string");
    expect(out.options).toBe("[ this is not valid json");
  });

  it("passes object fields through untouched when no schema is provided", () => {
    const out = coerceMcpToolArgs({
      options: JSON.stringify(STRUCTURED_OPTIONS),
      callingPopulation: "human",
    });

    // No schema => no safe way to know `options` is meant to be structured.
    expect(typeof out.options).toBe("string");
    expect(out.callingPopulation).toBe("human");
  });

  it("does not mutate the caller's input object or nested arrays", () => {
    const input = {
      context: "x",
      callingPopulation: "human",
      options: [{ id: "a", description: "A", features: JSON.stringify({ x: 1 }) }],
    };
    const snapshot = JSON.parse(JSON.stringify(input));

    coerceMcpToolArgs(input, PRINCIPLE_DECIDE_SCHEMA);

    expect(input).toEqual(snapshot);
  });
});

describe("coerceMcpToolArgs — non-object payloads", () => {
  it("returns {} for a bare string that is not JSON", () => {
    expect(coerceMcpToolArgs("not json at all", PRINCIPLE_DECIDE_SCHEMA)).toEqual(
      {},
    );
  });

  it("returns {} for a JSON string that parses to a non-object", () => {
    expect(coerceMcpToolArgs("[1,2,3]", PRINCIPLE_DECIDE_SCHEMA)).toEqual({});
    expect(coerceMcpToolArgs("42", PRINCIPLE_DECIDE_SCHEMA)).toEqual({});
  });

  it("returns {} for null / undefined / number payloads", () => {
    expect(coerceMcpToolArgs(null, PRINCIPLE_DECIDE_SCHEMA)).toEqual({});
    expect(coerceMcpToolArgs(undefined, PRINCIPLE_DECIDE_SCHEMA)).toEqual({});
    expect(coerceMcpToolArgs(99, PRINCIPLE_DECIDE_SCHEMA)).toEqual({});
  });
});
