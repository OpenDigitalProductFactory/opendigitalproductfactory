import type { BuildFailureAxis } from "./progress-visibility-types";

export type NormalizedVerificationOutput = {
  typecheckPassed: boolean | null;
  testsPassed: number | null;
  testsFailed: number | null;
  outputExcerpt: string | null;
  observedAt: string | null;
  failureAxis: BuildFailureAxis | null;
};

type JsonRecord = Record<string, unknown>;

export function normalizeVerificationOutput(value: unknown): NormalizedVerificationOutput {
  if (!isRecord(value)) {
    return emptyVerification();
  }

  const typecheckPassed = booleanOrNull(value.typecheckPassed) ?? booleanOrNull(value.typeCheckPassed);
  const testsPassed = numberOrNull(value.testsPassed);
  const testsFailed = numberOrNull(value.testsFailed);
  const output = firstString(
    value.fullOutput,
    value.testOutput,
    value.typeCheckOutput,
    value.output,
    value.message,
  );
  const outputExcerpt = output ? output.slice(0, 2000) : null;

  return {
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

function isRecord(value: unknown): value is JsonRecord {
  return typeof value === "object" && value !== null && !Array.isArray(value);
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
