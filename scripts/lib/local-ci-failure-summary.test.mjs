import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { summarizeLocalCiOutput } from "./local-ci-failure-summary.mjs";

describe("summarizeLocalCiOutput", () => {
  test("extracts bounded failing test and check lines from noisy logs", () => {
    const summary = summarizeLocalCiOutput(`
      ✓ unrelated test
      FAIL apps/web/components/example/name-card.test.tsx > saves when enabled
      Error: expect(button).toBeEnabled()
      Failed Tests 1
      ❯ apps/web/components/example/name-card.test.tsx (1 test | 1 failed)
      Type error: apps/web/lib/example.ts:12:7 - error TS2322: Type 'string' is not assignable to type 'number'.
      error Command failed with exit code 2.
    `);

    assert.equal(summary.failedTests.length, 2);
    assert.equal(summary.failedChecks.length, 2);
    assert.match(summary.failedTests[0].text, /name-card\.test\.tsx/);
    assert.match(summary.failedChecks[0].text, /Type error/);
    assert.equal(summary.truncated, false);
  });

  test("caps summaries so agents do not need truncated tail scraping", () => {
    const log = Array.from({ length: 80 }, (_, i) => `FAIL file-${i}.test.ts > case ${i}`).join("\n");
    const summary = summarizeLocalCiOutput(log, { maxEntries: 5 });

    assert.equal(summary.failedTests.length, 5);
    assert.equal(summary.omittedFailureLineCount, 75);
    assert.equal(summary.truncated, true);
  });

  test("captures Vitest worker crashes as failed checks", () => {
    const summary = summarizeLocalCiOutput(`
      Vitest caught 4 unhandled errors during the test run.
      Error: [vitest-pool]: Worker forks emitted error.
      Caused by: Error: Worker exited unexpectedly
    `);

    assert.equal(summary.failedChecks.length, 3);
    assert.match(summary.failedChecks[0].text, /unhandled errors/);
    assert.match(summary.failedChecks[1].text, /vitest-pool/);
    assert.match(summary.failedChecks[2].text, /Worker exited unexpectedly/);
  });

  test("does not treat FAIL inside a passing test title as a failure (BI-FBB86A69)", () => {
    const summary = summarizeLocalCiOutput(`
      ✓ lib/decision-perspective/evaluator.test.ts > FAIL-SAFE: lexical relevance escalates even when the apparent stance APPROVES
      ✓ lib/build/coding-agent.test.ts > outputIndicatesTestFailure > detects an ANSI FAIL marker line
       Test Files  2788 passed | 4 skipped (2792)
            Tests  23925 passed | 17 skipped | 18 todo (23960)
      [local-ci-vitest] classification=passed attempts=1 recovered=false
      Prisma schema loaded from prisma/schema.
    `);

    assert.equal(summary.failedTests.length, 0);
    assert.equal(summary.failedChecks.length, 0);
    assert.equal(summary.omittedFailureLineCount, 0);
  });
});
