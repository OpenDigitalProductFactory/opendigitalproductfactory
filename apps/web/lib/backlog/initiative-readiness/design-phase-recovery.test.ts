import { describe, expect, it } from "vitest";

import { designPhaseReviewDecision } from "./design-phase-recovery";
import { readinessRequirement } from "./readiness-guidance";
import type { InitiativeReadinessDecision } from "./types";

// BI-EE99767C. #5650 routes owed design reviews ahead of the baseline chain, but
// only for the codes a FEATURE item carries. A fix-profile large item owes its
// spec approval as OBJECTIVE_BASELINE_REQUIRED held by the design-checklist
// reviewer, and never carries SPEC_APPROVAL_REQUIRED — so its first spec approval
// was unrequestable (BI-74B2A8CD, WC-8D031416, 2026-09-26).

function completion(unmet: InitiativeReadinessDecision["unmet"]): InitiativeReadinessDecision {
  return {
    decisionId: "IRD-DESIGN-PHASE",
    policyVersion: "initiative-readiness.v3",
    subject: { kind: "backlog-item", id: "BI-DESIGN-PHASE" },
    transitionObject: { kind: "backlog-item", id: "BI-DESIGN-PHASE", expectedVersion: "read-projection", targetState: "completion" },
    profile: "fix",
    target: "completion",
    verdict: "input-required",
    satisfied: [],
    unmet,
    blockers: [],
    evaluatedAt: "2026-09-26T12:00:00.000Z",
  };
}

describe("designPhaseReviewDecision", () => {
  it("treats a fix item's spec-approval baseline as a design review owed before delivery", () => {
    const decision = completion([
      readinessRequirement({ code: "PLAN_REQUIRED", state: "missing", accountableRole: "implementation-planner" }),
      readinessRequirement({ code: "ACCEPTANCE_EVIDENCE_REQUIRED", state: "missing", accountableRole: "acceptance-reviewer" }),
      readinessRequirement({ code: "OBJECTIVE_BASELINE_REQUIRED", state: "missing", accountableRole: "design-checklist-reviewer" }),
    ]);

    const phase = designPhaseReviewDecision(decision);

    expect(phase?.unmet.map((entry) => entry.code)).toEqual(["OBJECTIVE_BASELINE_REQUIRED"]);
  });

  it("never routes a body baseline, held by the product owner, to a spec approval", () => {
    const decision = completion([
      readinessRequirement({ code: "OBJECTIVE_BASELINE_REQUIRED", state: "missing", accountableRole: "product-owner" }),
      readinessRequirement({ code: "ACCEPTANCE_EVIDENCE_REQUIRED", state: "missing", accountableRole: "acceptance-reviewer" }),
    ]);

    expect(designPhaseReviewDecision(decision)).toBeNull();
  });

  it("keeps routing a feature item's design reviews as before", () => {
    const decision = completion([
      readinessRequirement({ code: "SPEC_APPROVAL_REQUIRED", state: "missing", accountableRole: "design-checklist-reviewer" }),
      readinessRequirement({ code: "DELIVERY_EVIDENCE_REQUIRED", state: "missing", accountableRole: "delivery-coordinator" }),
    ]);

    expect(designPhaseReviewDecision(decision)?.unmet.map((entry) => entry.code)).toEqual(["SPEC_APPROVAL_REQUIRED"]);
  });
});
