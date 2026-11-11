import type { FailureAnalysis } from "@/lib/change-review/failure-analysis";

/** Existing Build Studio verification payload, shared by authoring and review. */
export type VerificationOutput = {
  failureAnalysis?: FailureAnalysis;
  testsPassed: number;
  testsFailed: number;
  typecheckPassed: boolean;
  fullOutput: string;
  timestamp: string;
};

import type { BuildFailureAxis } from "./progress-visibility-types";
import { isRecord } from "@/lib/shared/coerce";
import type { SandboxTestResult } from "./coding-agent";

export type TestExecutionFacts = {
  verificationSource?: { workdir: string; baseRef: string; digest: string | null; unchanged: boolean; checkedAt: string };
  testsExecuted?: boolean;
  testsApplicable?: boolean | null;
  testsQualified?: boolean;
  testCommandPassed?: boolean | null;
  testSummariesComplete?: boolean | null;
  testCommands?: string[];
  testEvidenceConflict?: boolean;
  reportedQa?: { testsPassed: number; testsFailed: number; content: string };
};

/** A specialist report has no native completeness provenance. Keep its failure
 * separately until an independent reconciliation establishes complete scope.
 * Passing a few named files, even beside plausible summary prose, cannot do so. */
export function retainReportedQa<T extends TestExecutionFacts>(verification: T, reportedQa: TestExecutionFacts["reportedQa"], priorConflict = false) {
  const testEvidenceConflict = priorConflict || verification.testEvidenceConflict === true || (reportedQa?.testsFailed ?? 0) > 0;
  return { ...verification, ...(reportedQa ? { reportedQa } : {}), testEvidenceConflict,
    ...(testEvidenceConflict ? { testsQualified: false, parseConfidence: "low" as const } : {}) };
}

/** Qualification is separate from both a case count and the typecheck verdict. */
export function testsAreQualified(value: unknown): boolean {
  if (!isRecord(value) || value.testEvidenceConflict === true || value.testsQualified === false) return false;
  if (isRecord(value.verificationSource) && value.verificationSource.unchanged !== true) return false;
  if (value.testsApplicable === false && value.testsExecuted === false) {
    return value.testsPassed === 0 && value.testsFailed === 0;
  }
  return value.testsApplicable === true && value.testsExecuted === true && value.testCommandPassed === true && value.testSummariesComplete === true
    && typeof value.testsPassed === "number" && Number.isSafeInteger(value.testsPassed) && value.testsPassed > 0 && value.testsFailed === 0;
}

/** Only native runner observations enter executed counters; overall success is not a count. */
export function verificationFromSandboxResult(result: SandboxTestResult) {
  const testsPassed = numberOrNull(result.testsPassed) ?? 0;
  const testsFailed = numberOrNull(result.testsFailed) ?? 0;
  const testsExecuted = result.testsExecuted === true;
  const testsApplicable = typeof result.testsApplicable === "boolean" ? result.testsApplicable : null;
  const testCommandPassed = typeof result.testCommandPassed === "boolean" ? result.testCommandPassed : null;
  const testSummariesComplete = result.testSummariesComplete === true;
  const facts = { testsPassed, testsFailed, testsExecuted, testsApplicable, testCommandPassed, testSummariesComplete };
  return {
    typecheckPassed: result.typeCheckPassed,
    ...facts,
    testsQualified: testsAreQualified(facts),
    parseConfidence: testsApplicable === false || (testsExecuted && testCommandPassed !== null && testSummariesComplete) ? "high" as const : "low" as const,
    source: "deterministic-scoped" as const,
    scope: result.scope ?? "none" as const,
    testCommands: result.testCommands ?? [],
    testEvidenceConflict: false,
  };
}

export type NormalizedVerificationOutput = TestExecutionFacts & {
  typecheckPassed: boolean | null;
  testsPassed: number | null;
  testsFailed: number | null;
  outputExcerpt: string | null;
  observedAt: string | null;
  failureAxis: BuildFailureAxis | null;
};

export function normalizeVerificationOutput(value: unknown): NormalizedVerificationOutput {
  if (!isRecord(value)) {
    return emptyVerification();
  }

  // An explicit current unknown must not revive a stale legacy spelling.
  const typecheckPassed = Object.prototype.hasOwnProperty.call(value, "typecheckPassed")
    ? booleanOrNull(value.typecheckPassed) : booleanOrNull(value.typeCheckPassed);
  const testsPassed = numberOrNull(value.testsPassed);
  const observedFailed = numberOrNull(value.testsFailed);
  const hasTestFacts = ["testsExecuted", "testsApplicable", "testsQualified", "testEvidenceConflict", "testSummariesComplete", "verificationSource"]
    .some((key) => Object.prototype.hasOwnProperty.call(value, key)) || value.scope === "none";
  // Unqualified zero is not a passing verdict. Retain actual positive failures.
  const testsFailed = hasTestFacts && !testsAreQualified(value) && observedFailed === 0 ? null : observedFailed;
  const facts: TestExecutionFacts = hasTestFacts ? {
    ...(isRecord(value.verificationSource) && typeof value.verificationSource.workdir === "string" && typeof value.verificationSource.baseRef === "string" && typeof value.verificationSource.checkedAt === "string" ? {
      verificationSource: { workdir: value.verificationSource.workdir, baseRef: value.verificationSource.baseRef,
        digest: stringOrNull(value.verificationSource.digest), unchanged: value.verificationSource.unchanged === true, checkedAt: value.verificationSource.checkedAt },
    } : {}),
    testsExecuted: value.testsExecuted === true,
    testsApplicable: booleanOrNull(value.testsApplicable),
    testsQualified: testsAreQualified(value),
    testCommandPassed: booleanOrNull(value.testCommandPassed),
    testSummariesComplete: booleanOrNull(value.testSummariesComplete),
    testEvidenceConflict: value.testEvidenceConflict === true,
    ...(Array.isArray(value.testCommands) ? { testCommands: value.testCommands.filter((v): v is string => typeof v === "string") } : {}),
    ...(isRecord(value.reportedQa) && typeof value.reportedQa.content === "string" ? {
      reportedQa: { testsPassed: numberOrNull(value.reportedQa.testsPassed) ?? 0,
        testsFailed: numberOrNull(value.reportedQa.testsFailed) ?? 0, content: value.reportedQa.content },
    } : {}),
  } : {};
  const output = firstString(
    value.fullOutput,
    value.testOutput,
    value.typeCheckOutput,
    value.output,
    value.message,
  );
  const outputExcerpt = output ? output.slice(0, 2000) : null;

  return {
    ...facts,
    typecheckPassed,
    testsPassed,
    testsFailed,
    outputExcerpt,
    observedAt: stringOrNull(value.timestamp) ?? stringOrNull(value.updatedAt),
    failureAxis: failureAxisOrNull(value.failureAxis) ?? classifyVerificationFailureAxis({
      typecheckPassed,
      testsFailed,
      output: outputExcerpt,
    }),
  };
}

/** One prompt summary for both coworker context paths; a positive count is not PASS. */
export function formatVerificationSummary(value: unknown): string {
  const observed = normalizeVerificationOutput(value);
  const tests = observed.testsExecuted === false
    ? observed.testsApplicable === false ? "Tests: not applicable; no tests ran." : "Tests: no execution observed."
    : observed.testsExecuted === true
      ? observed.testsFailed === null ? `Tests: ${observed.testsPassed ?? "unknown"} passes observed; failure verdict not established.`
        : `Tests: ${observed.testsPassed ?? "unknown"} passed / ${observed.testsFailed} failed.`
      : "Tests: execution not established.";
  const typecheck = observed.typecheckPassed === null ? "not verified" : observed.typecheckPassed ? "passed" : "failed";
  return `${tests} Typecheck: ${typecheck}.${observed.testEvidenceConflict ? " Earlier reported test failures remain unresolved." : ""}`;
}

export function classifyVerificationFailureAxis(args: {
  typecheckPassed: boolean | null;
  testsFailed: number | null;
  output: string | null;
}): BuildFailureAxis | null {
  const output = (args.output ?? "").toLowerCase();
  if (output.includes("usage limit") || output.includes("you've hit your usage limit")) {
    return "usage-limit";
  }
  if (output.includes("rate limit") || output.includes("429")) {
    return "rate-limit";
  }
  if (output.includes("provider is temporarily unavailable") || output.includes("provider unavailable")) {
    return "provider-unavailable";
  }
  if (output.includes("auth error") || output.includes("oauth") || output.includes("unauthorized")) {
    return "auth";
  }
  if (output.includes("timed out") || output.includes("timeout")) {
    return "timeout";
  }
  if (args.typecheckPassed === false) {
    return "typecheck-failure";
  }
  if (typeof args.testsFailed === "number" && args.testsFailed > 0) {
    return "test-failure";
  }
  return null;
}

function emptyVerification(): NormalizedVerificationOutput {
  return {
    typecheckPassed: null,
    testsPassed: null,
    testsFailed: null,
    outputExcerpt: null,
    observedAt: null,
    failureAxis: null,
  };
}

function firstString(...values: unknown[]): string | null {
  for (const value of values) {
    const stringValue = stringOrNull(value);
    if (stringValue) {
      return stringValue;
    }
  }
  return null;
}

function stringOrNull(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value : null;
}

function numberOrNull(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function booleanOrNull(value: unknown): boolean | null {
  return typeof value === "boolean" ? value : null;
}

function failureAxisOrNull(value: unknown): BuildFailureAxis | null {
  if (typeof value !== "string") {
    return null;
  }
  return (
    value === "rate-limit"
    || value === "usage-limit"
    || value === "auth"
    || value === "timeout"
    || value === "test-failure"
    || value === "typecheck-failure"
    || value === "out-of-scope-noise"
    || value === "provider-unavailable"
    || value === "unknown"
  ) ? value : null;
}
