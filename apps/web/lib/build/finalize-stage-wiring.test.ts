// BI-FBA2FDBE — only a real failing verdict for the same gate identity is
// reused; a pass or a guard that could not run is always re-evaluated.
import { describe, expect, it } from "vitest";

import { GUARD_DID_NOT_RUN_MARKER } from "./finalize-stage-runner";
import { priorGauntletFailure, priorScopedTestsFailure } from "./finalize-stage-wiring";
import { SCOPED_TEST_RUNNER_IDENTITY } from "./scoped-test-failure";

const record = (evidence: Record<string, unknown>) => ({ evidence });

describe("priorGauntletFailure", () => {
  it("reuses a recorded failing verdict", () => {
    expect(priorGauntletFailure(record({ passed: false, failedGuards: ["Data-Impact Gate"], output: "[data-impact] FAILED" }), GUARD_DID_NOT_RUN_MARKER))
      .toEqual({ failedGuards: ["Data-Impact Gate"], treeSha: null });
  });

  it("never reuses a pass", () => {
    expect(priorGauntletFailure(record({ passed: true, failedGuards: [], output: "ok" }), GUARD_DID_NOT_RUN_MARKER)).toBeNull();
  });

  it("never reuses a run in which a guard could not evaluate the change", () => {
    const output = "[spec-plan-doc-gate] cannot resolve origin/main — the guard did not run. This is not a pass.";
    expect(priorGauntletFailure(record({ passed: false, failedGuards: ["Spec/Plan/Doc Gate"], output }), GUARD_DID_NOT_RUN_MARKER)).toBeNull();
  });

  it("returns null when nothing usable was recorded", () => {
    expect(priorGauntletFailure(undefined, GUARD_DID_NOT_RUN_MARKER)).toBeNull();
    expect(priorGauntletFailure({ evidence: { passed: false, failedGuards: [] } }, GUARD_DID_NOT_RUN_MARKER)).toBeNull();
  });
});

// BI-33B54E4B: one tree re-ran its failing scoped tests 500 times. A confirmed
// failure on the tree being tested, by the current runner, is reused.
describe("priorScopedTestsFailure", () => {
  const tree = "f".repeat(40);
  const failing = {
    tier: "in-platform-scoped-tests", passed: false, headTreeHash: tree, runner: SCOPED_TEST_RUNNER_IDENTITY,
    failure: "tests", failingTests: ["lib/a.test.ts > b"],
  };

  it("reuses a confirmed failure on the same tree by the current runner", () => {
    expect(priorScopedTestsFailure({ id: "t1", details: record(failing) }, tree))
      .toEqual({ failure: "tests", failingTests: ["lib/a.test.ts > b"], recordId: "t1", treeSha: tree });
  });

  it("re-runs on another tree", () => {
    expect(priorScopedTestsFailure({ id: "t1", details: record(failing) }, "e".repeat(40))).toBeNull();
  });

  it("re-runs a failure recorded by an older runner, which may have been the environment's fault", () => {
    const { runner: _runner, ...older } = failing;
    expect(priorScopedTestsFailure({ id: "t1", details: record(older) }, tree)).toBeNull();
  });

  it("never reuses a pass or a run that reached no verdict", () => {
    expect(priorScopedTestsFailure({ id: "t1", details: record({ ...failing, passed: true }) }, tree)).toBeNull();
    expect(priorScopedTestsFailure({ id: "t1", details: record({ ...failing, failure: "not-run" }) }, tree)).toBeNull();
    expect(priorScopedTestsFailure(null, tree)).toBeNull();
    expect(priorScopedTestsFailure({ id: "t1", details: record(failing) }, null)).toBeNull();
  });
});
