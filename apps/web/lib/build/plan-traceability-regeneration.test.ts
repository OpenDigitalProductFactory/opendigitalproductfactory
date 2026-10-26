import { describe, expect, it, vi } from "vitest";

import { decidePlanTraceabilityRegeneration, planNamesAcceptance, type PlanTraceabilityRegenerationDb } from "./plan-traceability-regeneration";

const legacyPlan = { tasks: [{ title: "One" }, { title: "Two" }] };
const PLAN_LANES = ["PLAN_REQUIRED", "PLAN_REVIEW_REQUIRED", "PLAN_COVERAGE_REQUIRED", "TRACEABILITY_INCOMPLETE"];

function db(stableCodes: string[] | null, regeneratedBefore = false): PlanTraceabilityRegenerationDb {
  return {
    backlogItemActivity: { findFirst: vi.fn(async () => stableCodes
      ? { payload: { stableCodes, transitionObject: { kind: "feature-build", id: "FB-1", targetState: "build" } } }
      : null) },
    buildActivity: { findFirst: vi.fn(async () => (regeneratedBefore ? { id: "a" } : null)) },
  };
}

describe("planNamesAcceptance", () => {
  it("is false only for a plan none of whose tasks names an acceptance id", () => {
    expect(planNamesAcceptance(legacyPlan)).toBe(false);
    expect(planNamesAcceptance({ tasks: [{ title: "One", satisfies: ["AC-1"] }] })).toBe(true);
    expect(planNamesAcceptance(null)).toBe(false);
  });
});

describe("decidePlanTraceabilityRegeneration (BI-6F2872FC)", () => {
  const args = { buildId: "FB-1", originatorRowId: "item-row", buildPlan: legacyPlan };

  it("regenerates a legacy plan once when only the plan lanes stand between it and build", async () => {
    expect(await decidePlanTraceabilityRegeneration({ ...args, db: db(PLAN_LANES) })).toEqual({ due: true });
  });

  it("leaves a plan that already names its acceptance ids to the coverage writer", async () => {
    expect(await decidePlanTraceabilityRegeneration({ ...args, buildPlan: { tasks: [{ title: "x", satisfies: ["AC-1"] }] }, db: db(PLAN_LANES) }))
      .toEqual({ due: false, reason: "plan-already-traced" });
  });

  it("does not regenerate while a design gate still refuses the build — a new plan cannot clear it", async () => {
    expect(await decidePlanTraceabilityRegeneration({ ...args, db: db([...PLAN_LANES, "SPEC_APPROVAL_REQUIRED"]) }))
      .toEqual({ due: false, reason: "other-gates-owed" });
  });

  it("does not regenerate a build the plan lanes do not refuse", async () => {
    expect(await decidePlanTraceabilityRegeneration({ ...args, db: db(["DEPENDENCY_UNRESOLVED"]) }))
      .toEqual({ due: false, reason: "plan-lanes-not-owed" });
    expect(await decidePlanTraceabilityRegeneration({ ...args, db: db(null) }))
      .toEqual({ due: false, reason: "plan-lanes-not-owed" });
  });

  it("regenerates at most once per build", async () => {
    expect(await decidePlanTraceabilityRegeneration({ ...args, db: db(PLAN_LANES, true) }))
      .toEqual({ due: false, reason: "already-regenerated" });
  });

  it("does nothing without a backlog subject", async () => {
    expect(await decidePlanTraceabilityRegeneration({ ...args, originatorRowId: null, db: db(PLAN_LANES) }))
      .toEqual({ due: false, reason: "no-backlog-subject" });
  });
});
