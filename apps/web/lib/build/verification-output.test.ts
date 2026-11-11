import { describe, expect, it } from "vitest";
import { classifyVerificationFailureAxis, normalizeVerificationOutput } from "./verification-output";

describe("normalizeVerificationOutput", () => {
  it("does not resurrect an old camel-case verdict over an explicit current unknown", () => {
    expect(normalizeVerificationOutput({ typecheckPassed: null, typeCheckPassed: true,
      testsPassed: 0, testsFailed: 0, testsExecuted: false, testsApplicable: null })).toMatchObject({ typecheckPassed: null, testsQualified: false });
  });
  it("preserves qualification and original report through a saved JSON roundtrip", () => {
    const original = {
      typecheckPassed: true, testsPassed: 0, testsFailed: 0,
      testsExecuted: false, testsApplicable: null, testsQualified: false,
      testEvidenceConflict: true,
      verificationSource: { workdir: "/isolated-fixture", baseRef: "fixture-base", digest: "a".repeat(64), unchanged: true, checkedAt: "2026-11-11T00:00:00Z" },
      reportedQa: { testsPassed: 99, testsFailed: 3, content: "retained report" },
      fullOutput: "No tests ran; original QA remains unresolved.",
    };
    const normalized = normalizeVerificationOutput(JSON.parse(JSON.stringify(original)));
    expect(normalized).toMatchObject({
      testsExecuted: false, testsApplicable: null, testsQualified: false,
      testEvidenceConflict: true, reportedQa: original.reportedQa,
      verificationSource: original.verificationSource,
    });
    // The existing owner/readiness view must not read an unqualified zero as green.
    expect(normalized.testsFailed).toBeNull();
  });

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
