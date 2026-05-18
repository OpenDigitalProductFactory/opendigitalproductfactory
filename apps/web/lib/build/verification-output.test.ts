import { describe, expect, it } from "vitest";
import { classifyVerificationFailureAxis, normalizeVerificationOutput } from "./verification-output";

describe("normalizeVerificationOutput", () => {
  it("normalizes current verification output", () => {
    expect(normalizeVerificationOutput({
      typecheckPassed: false,
      testsPassed: 10,
      testsFailed: 192,
      fullOutput: "mcp-tools-save-build-evidence.test.ts failed",
      timestamp: "2026-05-18T12:00:00.000Z",
    })).toEqual({
      typecheckPassed: false,
      testsPassed: 10,
      testsFailed: 192,
      outputExcerpt: "mcp-tools-save-build-evidence.test.ts failed",
      observedAt: "2026-05-18T12:00:00.000Z",
      failureAxis: "typecheck-failure",
    });
  });

  it("normalizes older typeCheckPassed spelling", () => {
    expect(normalizeVerificationOutput({
      typeCheckPassed: true,
      testsPassed: 4,
      testsFailed: 0,
      testOutput: "ok",
    })).toMatchObject({
      typecheckPassed: true,
      testsPassed: 4,
      testsFailed: 0,
      outputExcerpt: "ok",
      failureAxis: null,
    });
  });

  it("classifies provider and usage-limit failures from output text", () => {
    expect(classifyVerificationFailureAxis({
      typecheckPassed: null,
      testsFailed: null,
      output: "The AI provider is temporarily unavailable",
    })).toBe("provider-unavailable");

    expect(classifyVerificationFailureAxis({
      typecheckPassed: null,
      testsFailed: null,
      output: "ERROR: You've hit your usage limit",
    })).toBe("usage-limit");
  });

  it("returns null failure axis for clean verification", () => {
    expect(classifyVerificationFailureAxis({
      typecheckPassed: true,
      testsFailed: 0,
      output: "all good",
    })).toBe(null);
  });

  it("returns an empty verification shape for null input", () => {
    expect(normalizeVerificationOutput(null)).toEqual({
      typecheckPassed: null,
      testsPassed: null,
      testsFailed: null,
      outputExcerpt: null,
      observedAt: null,
      failureAxis: null,
    });
  });
});
