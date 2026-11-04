// pregate-exit-honesty.test.mjs — BI-A9CF0D69 (plan §3 M5, class D).
//
// Two honesty rules for the dev-loop gate wrapper:
//   1. Exit 0 MEANS "gated and passed": an elapsed admission window, or a zero
//      status the SHA-bound slot records cannot corroborate as PASS-at-HEAD,
//      exits ABANDONED_OR_UNRECORDED_EXIT_CODE instead of 0.
//   2. Every `process.exit(0)` in the wrapper/gate pair carries an inline
//      `// exit-0: <reason>` annotation. The set of silent-success sites is
//      thereby declared and enumerable — a new unannotated exit(0) fails here
//      rather than shipping a fresh way to read success into a did-not-run.
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import {
  ABANDONED_OR_UNRECORDED_EXIT_CODE,
  isRecordExemptInvocation,
  readReconciledVerdictAtHead,
  resolveWrapperExitCode,
} from "./pregate.mjs";

const SCRIPTS_DIR = dirname(fileURLToPath(import.meta.url));

describe("resolveWrapperExitCode", () => {
  it("maps an elapsed admission window to the distinct abandoned code, never 0", () => {
    assert.equal(
      resolveWrapperExitCode({ status: 0, timedOut: true, recordExempt: false, verdictAtHead: "PASS" }),
      ABANDONED_OR_UNRECORDED_EXIT_CODE,
    );
  });

  it("refuses a zero status with no corroborating PASS record (red case)", () => {
    assert.equal(
      resolveWrapperExitCode({ status: 0, timedOut: false, recordExempt: false, verdictAtHead: "" }),
      ABANDONED_OR_UNRECORDED_EXIT_CODE,
    );
    assert.equal(
      resolveWrapperExitCode({ status: 0, timedOut: false, recordExempt: false, verdictAtHead: "NO-RECORD" }),
      ABANDONED_OR_UNRECORDED_EXIT_CODE,
    );
  });

  it("passes zero through only for PASS-at-HEAD or a record-exempt invocation", () => {
    assert.equal(
      resolveWrapperExitCode({ status: 0, timedOut: false, recordExempt: false, verdictAtHead: "PASS" }),
      0,
    );
    assert.equal(
      resolveWrapperExitCode({ status: 0, timedOut: false, recordExempt: true, verdictAtHead: "" }),
      0,
    );
  });

  it("keeps a genuine failure status, and coerces a killed spawn's null to 1", () => {
    assert.equal(resolveWrapperExitCode({ status: 86, timedOut: false, recordExempt: false, verdictAtHead: "" }), 86);
    assert.equal(resolveWrapperExitCode({ status: null, timedOut: false, recordExempt: false, verdictAtHead: "" }), 1);
  });
});

describe("isRecordExemptInvocation", () => {
  it("exempts exactly the closed no-record modes", () => {
    assert.equal(isRecordExemptInvocation(["--dry-run"]), true);
    assert.equal(isRecordExemptInvocation(["--finalize-evidence"]), true);
    assert.equal(isRecordExemptInvocation(["--help"]), true);
    assert.equal(isRecordExemptInvocation(["-h"]), true);
    assert.equal(isRecordExemptInvocation([]), false);
    assert.equal(isRecordExemptInvocation(["--push"]), false);
  });
});

describe("readReconciledVerdictAtHead", () => {
  it("fails closed to empty when context or records are unavailable", () => {
    assert.equal(readReconciledVerdictAtHead({ resolveContextImpl: () => null }), "");
    assert.equal(
      readReconciledVerdictAtHead({
        resolveContextImpl: () => ({}),
        collectVerdictsImpl: () => [],
      }),
      "",
    );
    assert.equal(
      readReconciledVerdictAtHead({
        resolveContextImpl: () => { throw new Error("git unavailable"); },
      }),
      "",
    );
  });

  it("reduces slot records through the reconciler", () => {
    assert.equal(
      readReconciledVerdictAtHead({
        resolveContextImpl: () => ({}),
        collectVerdictsImpl: () => [{ verdict: "PASS" }],
        reconcileImpl: (slots) => slots[0],
      }),
      "PASS",
    );
  });
});

describe("exit(0) sites are declared", () => {
  it("every process.exit(0) in the wrapper/gate pair carries an exit-0 annotation", () => {
    const offenders = [];
    for (const file of ["pregate.mjs", "gate-worktree.mjs", "pregate-status.mjs"]) {
      const lines = readFileSync(join(SCRIPTS_DIR, file), "utf8").split("\n");
      lines.forEach((line, index) => {
        if (/process\.exit\(0\)/.test(line) && !/\/\/ exit-0: \S/.test(line)) {
          offenders.push(`${file}:${index + 1}: ${line.trim()}`);
        }
      });
    }
    assert.deepEqual(
      offenders,
      [],
      `unannotated process.exit(0) — declare why this success is honest with a trailing "// exit-0: <reason>":\n${offenders.join("\n")}`,
    );
  });
});
