import { describe, expect, it, beforeEach } from "vitest";
import {
  registerExecutionAdapter,
  getExecutionAdapter,
  _resetAdaptersForTest,
} from "./execution-adapter-registry";
import type { ExecutionAdapterHandler } from "./adapter-types";

const fakeAdapter: ExecutionAdapterHandler = {
  type: "fake",
  execute: async () => ({
    text: "",
    toolCalls: [],
    usage: { inputTokens: 0, outputTokens: 0 },
    inferenceMs: 0,
  }),
};

describe("execution-adapter-registry", () => {
  beforeEach(() => {
    _resetAdaptersForTest();
  });

  it("registers and retrieves an adapter", () => {
    registerExecutionAdapter(fakeAdapter);
    expect(getExecutionAdapter("fake")).toBe(fakeAdapter);
  });

  it("throws for unknown adapter type", () => {
    expect(() => getExecutionAdapter("nonexistent")).toThrow(
      /No execution adapter registered for type "nonexistent"/,
    );
  });

  it("overwrites on duplicate registration", () => {
    registerExecutionAdapter(fakeAdapter);
    const replacement: ExecutionAdapterHandler = {
      type: "fake",
      execute: async () => ({
        text: "replaced",
        toolCalls: [],
        usage: { inputTokens: 0, outputTokens: 0 },
        inferenceMs: 0,
      }),
    };
    registerExecutionAdapter(replacement);
    expect(getExecutionAdapter("fake")).toBe(replacement);
  });
});
