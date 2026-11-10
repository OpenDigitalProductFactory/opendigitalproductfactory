// apps/web/lib/build/scoped-test-failure.ts
//
// BI-33B54E4B: what a scoped-test run actually concluded. A failure names its
// failing tests so the repair hand-back and the owner escalation can say which,
// and a run that reached no verdict (runner crash, missing module) is reported
// as not run rather than blamed on the change.

import type { SandboxTestResult } from "./coding-agent";

/**
 * Identity of the scoped-test runner, recorded on each scoped-test record. A
 * recorded failure is reused only when the same runner produced it, so a fix to
 * the runner itself (here: NODE_ENV=test) re-tests every tree once.
 */
export const SCOPED_TEST_RUNNER_IDENTITY = "scoped-tests/node-env-test@1";

/** Failing tests are listed this many at most; the record keeps the full output. */
const MAX_FAILING_TESTS = 20;

function stripAnsi(text: string): string {
  // eslint-disable-next-line no-control-regex -- ANSI colour strip
  return text.replace(/\x1b\[[0-9;]*m/g, "");
}

/** Each failing test a Vitest or Jest run printed, once, in output order. */
export function failingTestNames(output: string): string[] {
  const names: string[] = [];
  for (const raw of stripAnsi(output).split(/\r?\n/)) {
    const line = raw.trim();
    const match = /^FAIL\s+(.+)$/.exec(line) ?? /^●\s+(.+)$/.exec(line);
    const name = match?.[1]?.trim();
    if (name && !names.includes(name)) names.push(name);
    if (names.length >= MAX_FAILING_TESTS) break;
  }
  return names;
}

export type ScopedTestVerdict =
  | { kind: "passed" }
  | { kind: "tests"; failingTests: string[] }
  | { kind: "typecheck"; failingTests: string[] }
  | { kind: "not-run"; reason: string };

export function classifyScopedTestResult(
  result: Pick<SandboxTestResult, "passed" | "typeCheckPassed" | "testOutput">,
): ScopedTestVerdict {
  if (result.passed && result.typeCheckPassed) return { kind: "passed" };
  const failingTests = failingTestNames(result.testOutput);
  const clean = stripAnsi(result.testOutput);
  const testsFailed = failingTests.length > 0 || /\b[1-9]\d*\s+failed/i.test(clean);
  if (testsFailed) return { kind: "tests", failingTests };
  if (!result.typeCheckPassed) return { kind: "typecheck", failingTests: [] };
  return { kind: "not-run", reason: "the test runner reported no failing test and no passing verdict" };
}
