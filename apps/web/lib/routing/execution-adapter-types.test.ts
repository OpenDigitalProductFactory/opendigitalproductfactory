// apps/web/lib/routing/execution-adapter-types.test.ts
//
// Phase A4: ExecutionAdapterSelector + capability-requirement type tests.
//
// Spec: docs/superpowers/specs/2026-04-29-coworker-execution-adapter-substrate-design.md §5.1
// Plan: docs/superpowers/plans/2026-04-29-coworker-execution-adapter-substrate-plan.md (Task A4)

import { describe, it, expect } from "vitest";
import {
  parseExecutionAdapterSelector,
  type AdapterCapabilityRequirement,
  type ExecutionAdapterKind,
  type ExecutionAdapterSelector,
} from "./execution-adapter-types";

/**
 * Compile-time exhaustiveness sentinel. If a new ExecutionAdapterKind is added
 * to the union without updating this switch, TypeScript fails to compile the
 * `_default: never` arm. Runtime call exercises every branch.
 */
function describeKind(kind: ExecutionAdapterKind): string {
  switch (kind) {
    case "http-anthropic":
      return "http-anthropic";
    case "http-openai":
      return "http-openai";
    case "http-gemini":
      return "http-gemini";
    case "http-ollama":
      return "http-ollama";
    case "http-generic":
      return "http-generic";
    case "claude-code-cli":
      return "claude-code-cli";
    case "codex-cli":
      return "codex-cli";
    case "codex-mcp-server":
      return "codex-mcp-server";
    case "local-runtime":
      return "local-runtime";
    default: {
      const _exhaustive: never = kind;
      return _exhaustive;
    }
  }
}

describe("ExecutionAdapterKind exhaustiveness", () => {
  it("covers every declared kind in the switch", () => {
    const kinds: ExecutionAdapterKind[] = [
      "http-anthropic",
      "http-openai",
      "http-gemini",
      "http-ollama",
      "http-generic",
      "claude-code-cli",
      "codex-cli",
      "codex-mcp-server",
      "local-runtime",
    ];
    for (const k of kinds) {
      expect(describeKind(k)).toBe(k);
    }
  });
});

describe("parseExecutionAdapterSelector — legacy string round-trip", () => {
  it('maps "claude-cli" to claude-code-cli + oauth', () => {
    expect(parseExecutionAdapterSelector("claude-cli")).toEqual({
      kind: "claude-code-cli",
      authMode: "oauth",
    });
  });

  it('maps "codex-cli" to codex-cli + oauth', () => {
    expect(parseExecutionAdapterSelector("codex-cli")).toEqual({
      kind: "codex-cli",
      authMode: "oauth",
    });
  });

  it('maps "chat" to http-generic + api-key', () => {
    expect(parseExecutionAdapterSelector("chat")).toEqual({
      kind: "http-generic",
      authMode: "api-key",
    });
  });
});

describe("parseExecutionAdapterSelector — object passthrough", () => {
  it("returns a value-equal object when given a valid selector", () => {
    const input: ExecutionAdapterSelector = {
      kind: "claude-code-cli",
      authMode: "oauth",
      version: "claude-code/1.2.3",
      containerHint: "dpf-sandbox-1",
    };
    expect(parseExecutionAdapterSelector(input)).toEqual(input);
  });

  it("preserves a minimal valid selector (no version, no containerHint)", () => {
    const input: ExecutionAdapterSelector = {
      kind: "http-anthropic",
      authMode: "api-key",
    };
    expect(parseExecutionAdapterSelector(input)).toEqual(input);
  });
});

describe("parseExecutionAdapterSelector — invalid input", () => {
  it("throws on an unknown legacy string with the offending value in the message", () => {
    expect(() => parseExecutionAdapterSelector("nonsense")).toThrow(/nonsense/);
  });

  it("throws on undefined with executionAdapter is required", () => {
    expect(() => parseExecutionAdapterSelector(undefined)).toThrow(
      /executionAdapter is required/,
    );
  });

  it("throws on null with executionAdapter is required", () => {
    expect(() => parseExecutionAdapterSelector(null)).toThrow(
      /executionAdapter is required/,
    );
  });
});

describe("AdapterCapabilityRequirement shape", () => {
  it("accepts a capability key + required boolean", () => {
    const req: AdapterCapabilityRequirement = {
      capability: "supportsSubagents",
      required: true,
    };
    expect(typeof req.capability).toBe("string");
    expect(typeof req.required).toBe("boolean");
  });

  it("accepts an advisory (required: false) requirement", () => {
    const req: AdapterCapabilityRequirement = {
      capability: "supportsTodoState",
      required: false,
    };
    expect(req.required).toBe(false);
  });
});
