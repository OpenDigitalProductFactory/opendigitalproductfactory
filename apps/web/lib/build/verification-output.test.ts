import { describe, expect, it } from "vitest";
import { classifyVerificationFailureAxis, normalizeVerificationOutput, projectVerificationEvidence } from "./verification-output";

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

describe("saved verification presentation", () => {
  const observed = { typecheckPassed: true, testsPassed: 4, testsFailed: 0, testsExecuted: true,
    testsApplicable: true, testCommandPassed: true, testSummariesComplete: true };
  it.each([
    { typecheckPassed: true, testsPassed: 1, testsFailed: 0, testsExecuted: false, testsApplicable: null },
    { typecheckPassed: true, testsPassed: 12, testsFailed: 0 },
  ])("never projects an unestablished counter as a qualified pass", value => {
    const display = projectVerificationEvidence(normalizeVerificationOutput(value));
    expect(display).toMatchObject({ qualified: false, label: "Unverified" });
    expect(display.testsLabel).not.toContain("passed");
  });
  it("retains full QA and actual source/commands in the existing raw disclosure", () => {
    const content = `${"Original QA ".repeat(250)}END-OF-ORIGINAL`;
    const display = projectVerificationEvidence(normalizeVerificationOutput({ ...observed, testEvidenceConflict: true,
      reportedQa: { testsPassed: 99, testsFailed: 3, content }, testCommands: ["fixture scoped test command"],
      verificationSource: { workdir: "/isolated", baseRef: "fixture-base", digest: "a".repeat(64), unchanged: true,
        checkedAt: "2026-11-11T00:00:00Z" } }));
    expect(display).toMatchObject({ qualified: false, label: "Unverified" });
    expect(display.testsLabel).toContain("4 passes observed");
    expect(display.rawOutput).toContain(content);
    expect(display.rawOutput).toContain("fixture scoped test command");
    expect(display.rawOutput).toContain("fixture-base");
  });
  it("keeps source-invalidated failures historical without calling the new source failed or passed", () => {
    const display = projectVerificationEvidence(normalizeVerificationOutput({ ...observed, typecheckPassed: null,
      testsFailed: 1, testsQualified: false, verificationSource: { workdir: "/isolated", baseRef: "main", digest: "old",
        unchanged: false, checkedAt: "2026-11-11T00:00:00Z" } }));
    expect(display).toMatchObject({ label: "Unverified", qualified: false, failed: false, typecheckLabel: "Not verified" });
    expect(display.testsLabel).toContain("4 passed, 1 failed (observed)");
  });
  it("distinguishes current executed pass, failure and established exemption", () => {
    expect(projectVerificationEvidence(normalizeVerificationOutput(observed))).toMatchObject({ label: "Passed", qualified: true });
    expect(projectVerificationEvidence(normalizeVerificationOutput({ ...observed, testsFailed: 1, testCommandPassed: false })))
      .toMatchObject({ label: "Failed", qualified: false });
    expect(projectVerificationEvidence(normalizeVerificationOutput({ typecheckPassed: true, testsPassed: 0, testsFailed: 0,
      testsExecuted: false, testsApplicable: false }))).toMatchObject({ label: "Typecheck only", qualified: true, exempt: true,
        testsLabel: "Not applicable; no tests ran." });
  });
});
