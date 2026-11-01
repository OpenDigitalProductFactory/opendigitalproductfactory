import { describe, expect, it } from "vitest";

import {
  buildGuardResult,
  buildRunRecord,
  validateRunRecord,
} from "../../../../../scripts/lib/guard-outcome-record.mjs";

import {
  guardOutcomeClassificationRowId,
  guardOutcomeRunRowId,
  validateGuardOutcomeRun,
} from "./guard-outcome-run";

const SHA = "a".repeat(40);

function clientRecord(overrides: Record<string, unknown> = {}) {
  return {
    ...buildRunRecord({
      runner: "pre-push-gate",
      runId: "00000000-0000-4000-8000-000000000009",
      startedAt: Date.parse("2026-10-14T00:00:00Z"),
      durationMs: 3,
      diff: { cloneKey: "0".repeat(16), branch: "feat/x", baseSha: SHA, headSha: SHA, patchId: null, dirty: false },
      guards: [buildGuardResult({ guardId: "hook:pre-push-gate", kind: "hook", guardDigest: "b".repeat(64), verdict: "passed", durationMs: 3 })],
    }),
    override: { kind: "local-ci-override", code: "docs-adjacent", reason: "docs-adjacent: readme" },
    ...overrides,
  };
}

describe("validateGuardOutcomeRun — in step with the client's validator", () => {
  const cases: Array<[string, Record<string, unknown>]> = [
    ["valid", {}],
    ["bad runner", { runner: "ci" }],
    ["bad schema", { schema: "guard-outcome-run.v0" }],
    ["bad startedAt", { startedAt: "yesterday" }],
    ["bad diff", { diff: { cloneKey: "x", branch: "", baseSha: "x", headSha: "x", patchId: "x", dirty: "no" } }],
    ["bad override", { override: { kind: "please" } }],
    ["bad guards", { guards: [{ guardId: "nope", kind: "x", guardDigest: "x", baselineDigest: "x", verdict: "x", durationMs: -1 }] }],
  ];

  it.each(cases)("%s: platform and client agree", (_label, overrides) => {
    const record = clientRecord(overrides);
    const clientOk = validateRunRecord(record).length === 0;
    expect(validateGuardOutcomeRun(record).valid).toBe(clientOk);
  });

  it("names the failing fields and keeps the runId when it is valid", () => {
    const result = validateGuardOutcomeRun(clientRecord({ runner: "ci" }));
    expect(result).toEqual({ valid: false, runId: "00000000-0000-4000-8000-000000000009", reason: "invalid: runner" });
  });

  it("refuses more than 400 guard results", () => {
    const guard = buildGuardResult({ guardId: "loop:x", kind: "guard", guardDigest: "b".repeat(64), verdict: "passed", durationMs: 1 });
    const result = validateGuardOutcomeRun(clientRecord({ guards: Array.from({ length: 401 }, () => guard) }));
    expect(result.valid).toBe(false);
  });
});

describe("row ids", () => {
  it("derive deterministically from the runId and (runId, guardId)", () => {
    expect(guardOutcomeRunRowId("r1")).toBe(guardOutcomeRunRowId("r1"));
    expect(guardOutcomeRunRowId("r1")).not.toBe(guardOutcomeRunRowId("r2"));
    expect(guardOutcomeRunRowId("r1")).toMatch(/^gor_[0-9a-f]{24}$/);
    expect(guardOutcomeClassificationRowId("r1", "loop:x")).toMatch(/^goc_[0-9a-f]{24}$/);
  });
});
