// BI-33B54E4B: a scoped-test stop names what failed, so the repair hand-back and
// the owner escalation can say which tests, and an unrun suite is never blamed on
// the change.
import { describe, expect, it } from "vitest";

import { classifyScopedTestResult, failingTestNames } from "./scoped-test-failure";

const vitestOutput = [
  "# apps/web",
  "\x1b[41m\x1b[1m FAIL \x1b[22m\x1b[49m lib/queue/functions/self-upgrade.test.ts\x1b[2m > \x1b[22mskip-before-drain guards\x1b[2m > \x1b[22mmarks a pre-created queued run skipped",
  " FAIL  lib/finance/ledger.test.ts > LEDGER_REPORT_SECTIONS > pins the figures",
  " FAIL  lib/finance/ledger.test.ts > LEDGER_REPORT_SECTIONS > pins the figures",
  " Test Files  2 failed | 1 passed (3)",
].join("\n");

describe("failingTestNames", () => {
  it("lists each failing Vitest test once, without colour codes", () => {
    expect(failingTestNames(vitestOutput)).toEqual([
      "lib/queue/functions/self-upgrade.test.ts > skip-before-drain guards > marks a pre-created queued run skipped",
      "lib/finance/ledger.test.ts > LEDGER_REPORT_SECTIONS > pins the figures",
    ]);
  });

  it("lists failing Jest tests", () => {
    expect(failingTestNames("FAIL src/a.test.ts\n  ● visitor store › keeps the draft\n")).toEqual([
      "src/a.test.ts",
      "visitor store › keeps the draft",
    ]);
  });

  it("returns nothing for a passing run", () => {
    expect(failingTestNames(" Test Files  3 passed (3)")).toEqual([]);
  });
});

describe("classifyScopedTestResult", () => {
  const base = { passed: false, typeCheckPassed: true, testOutput: vitestOutput, typeCheckOutput: "", scope: "scoped" as const };

  it("names the failing tests of a genuine test failure", () => {
    expect(classifyScopedTestResult(base)).toEqual({
      kind: "tests",
      failingTests: [
        "lib/queue/functions/self-upgrade.test.ts > skip-before-drain guards > marks a pre-created queued run skipped",
        "lib/finance/ledger.test.ts > LEDGER_REPORT_SECTIONS > pins the figures",
      ],
    });
  });

  it("reports a typecheck failure in the changed files", () => {
    expect(classifyScopedTestResult({ ...base, typeCheckPassed: false, testOutput: " Test Files  1 passed (1)" }))
      .toEqual({ kind: "typecheck", failingTests: [] });
  });

  it("treats a run that reports no failing test as not run, never as the change's failure", () => {
    expect(classifyScopedTestResult({ ...base, testOutput: "Error: Cannot find module 'vitest/config'" }))
      .toMatchObject({ kind: "not-run" });
  });

  it("passes a passing run", () => {
    expect(classifyScopedTestResult({ ...base, passed: true, testOutput: " Test Files  1 passed (1)" })).toEqual({ kind: "passed" });
  });
});
