import { describe, expect, it } from "vitest";
import { GATE_REQUIREMENTS } from "@/lib/explore/build-process-matrix";
import { PLAN_TO_BUILD_GATE_PROFILES } from "@/lib/build/plan-to-build-transition-core";
import {
  BUILD_STUDIO_EVIDENCE_MAP,
  CANONICAL_PLAN_TO_BUILD_PRECONDITIONS,
  PLAN_TO_BUILD_MODE_RANK,
  lifecycleVariantDeltas,
  planToBuildDivergences,
} from "./build-studio.realization";

describe("Build Studio's recorded realization", () => {
  it("accounts for every runtime gate requirement without inventing evidence", () => {
    expect(Object.keys(BUILD_STUDIO_EVIDENCE_MAP).sort()).toEqual([...GATE_REQUIREMENTS].sort());
    expect(BUILD_STUDIO_EVIDENCE_MAP["fixContext-complete"]).toBeNull();
    expect(BUILD_STUDIO_EVIDENCE_MAP["verification-depth-satisfied"]).toBeNull();
    expect(BUILD_STUDIO_EVIDENCE_MAP["verification-typecheck-passed"]).toBe("passing-test");
  });

  it("treats soft refusal as blocking, and recorded omission as unevaluated", () => {
    expect(PLAN_TO_BUILD_MODE_RANK).toEqual({
      blocking: 5, "blocking-soft": 5, "autonomous-mode": 4,
      upstream: 3, "not-evaluated-recorded": 2, "not-evaluated": 1,
    });
    expect(CANONICAL_PLAN_TO_BUILD_PRECONDITIONS).toBe(PLAN_TO_BUILD_GATE_PROFILES["advance-build-phase"].callerChecksBefore);
  });

  it("identifies a missing canonical gate and caller check on an alternate path", () => {
    const profiles = structuredClone(PLAN_TO_BUILD_GATE_PROFILES);
    const changed = {
      ...profiles,
      "save-phase-handoff": {
        ...profiles["save-phase-handoff"],
        gates: { ...profiles["save-phase-handoff"].gates, "wwmd-plan-advancement": "not-evaluated" as const },
        callerChecksBefore: ["auto-advance requested"],
      },
    };
    const rows = planToBuildDivergences(changed);
    expect(rows).toContainEqual(expect.objectContaining({ path: "save-phase-handoff", gate: "wwmd-plan-advancement", kind: "weaker-gate", backlogItem: "BI-5D59A982" }));
    expect(rows).toContainEqual(expect.objectContaining({ path: "save-phase-handoff", gate: "Approve Start", kind: "missing-precondition" }));
    expect(rows.some((row) => row.path === "advance-build-phase")).toBe(false);
  });

  it("does not mislabel a blocking-soft transition as weaker enforcement", () => {
    const profiles = {
      ...PLAN_TO_BUILD_GATE_PROFILES,
      "save-phase-handoff": {
        ...PLAN_TO_BUILD_GATE_PROFILES["save-phase-handoff"],
        gates: { ...PLAN_TO_BUILD_GATE_PROFILES["advance-build-phase"].gates, "structural-phase-gate": "blocking-soft" as const },
        callerChecksBefore: [...CANONICAL_PLAN_TO_BUILD_PRECONDITIONS],
      },
    };
    expect(planToBuildDivergences(profiles).filter((row) => row.path === "save-phase-handoff"))
      .toEqual([expect.objectContaining({ gate: "structural-phase-gate", kind: "reporting-only" })]);
  });

  it("records every lifecycle cell and rightsizing variant deterministically", () => {
    const rows = lifecycleVariantDeltas();
    expect(rows).toHaveLength(16 * 5);
    expect(new Set(rows.map((row) => `${row.type}/${row.size}/${row.variant}`)).size).toBe(rows.length);
    expect(rows).toEqual(lifecycleVariantDeltas());
    // One readable row per cell/variant, rather than thousands of repeated
    // empty arrays. Retains every actual phase/requirement delta for review.
    expect(rows.map((row) => `${row.type}/${row.size}/${row.variant}: skipped=${row.skippedPhases.join(",") || "none"}; gates=${JSON.stringify(row.gates)}`).join("\n")).toMatchSnapshot();
  });
});
