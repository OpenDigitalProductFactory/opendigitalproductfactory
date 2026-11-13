// BI-33B54E4B: which finalize stops go back to the coding agent, and with what.
import { describe, expect, it } from "vitest";

import { repairFailureForFinalize } from "./finalize-repair-routing";

describe("repairFailureForFinalize", () => {
  it("hands a test failure back with each failing test named, bound to its tree and record", () => {
    expect(repairFailureForFinalize({
      status: "tests-failed", failure: "tests", recordId: "t1", treeSha: "tree",
      failingTests: ["lib/finance/ledger.test.ts > LEDGER_REPORT_SECTIONS > pins the figures"],
    })).toEqual({
      treeSha: "tree", recordId: "t1", failedGuards: ["Scoped tests"], source: "tests",
      findings: [{ severity: "important", description: "Failing test: lib/finance/ledger.test.ts > LEDGER_REPORT_SECTIONS > pins the figures" }],
    });
  });

  it("hands a typecheck failure back as a typecheck finding", () => {
    expect(repairFailureForFinalize({ status: "tests-failed", failure: "typecheck", recordId: "t1", treeSha: "tree", failingTests: [] }))
      .toMatchObject({ failedGuards: ["Typecheck"], findings: [{ description: expect.stringMatching(/typecheck fails/i) }] });
  });

  it("points at the recorded output when the failing tests could not be named", () => {
    expect(repairFailureForFinalize({ status: "tests-failed", failure: "tests", recordId: "t1", treeSha: "tree", failingTests: [] }))
      .toMatchObject({ findings: [{ description: expect.stringMatching(/recorded test output/) }] });
  });

  it("never hands back a stop the change cannot fix", () => {
    expect(repairFailureForFinalize({ status: "tests-not-run", reason: "runner crashed" })).toBeNull();
    expect(repairFailureForFinalize({ status: "gauntlet-not-run", reason: "r" })).toBeNull();
    expect(repairFailureForFinalize({ status: "unbound" })).toBeNull();
  });
});
