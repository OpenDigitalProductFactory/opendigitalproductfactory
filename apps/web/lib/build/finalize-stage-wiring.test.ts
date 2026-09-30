// BI-FBA2FDBE — only a real failing verdict for the same gate identity is
// reused; a pass or a guard that could not run is always re-evaluated.
import { describe, expect, it } from "vitest";

import { GUARD_DID_NOT_RUN_MARKER } from "./finalize-stage-runner";
import { priorGauntletFailure } from "./finalize-stage-wiring";

const record = (evidence: Record<string, unknown>) => ({ evidence });

describe("priorGauntletFailure", () => {
  it("reuses a recorded failing verdict", () => {
    expect(priorGauntletFailure(record({ passed: false, failedGuards: ["Data-Impact Gate"], output: "[data-impact] FAILED" }), GUARD_DID_NOT_RUN_MARKER))
      .toEqual({ failedGuards: ["Data-Impact Gate"] });
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
