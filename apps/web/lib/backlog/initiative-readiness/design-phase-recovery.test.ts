import { describe, expect, it } from "vitest";

import { decisionForIndependentReview, designPhaseReviewDecision } from "./design-phase-recovery";
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
  it("keeps terminal writers on completion while design writers use pre-delivery obligations", () => {
    const design = completion([readinessRequirement({ code: "SPEC_APPROVAL_REQUIRED", state: "missing", accountableRole: "design-checklist-reviewer" })]);
    const terminal = completion([readinessRequirement({ code: "ACCEPTANCE_EVIDENCE_REQUIRED", state: "missing", accountableRole: "acceptance-reviewer" })]);
    const decisions = { implementation: { ...design, target: "implementation" as const }, completion: terminal };
    expect(decisionForIndependentReview("record_initiative_design_review", decisions)?.target).toBe("implementation");
    expect(decisionForIndependentReview("record_initiative_post_implementation_review", decisions)).toBe(terminal);
    expect(decisionForIndependentReview("record_initiative_evidence", decisions)).toBe(terminal);
  });

  it("does not revive a completed design gate from unrelated completion obligations", () => {
    const terminal = completion([readinessRequirement({ code: "SPEC_APPROVAL_REQUIRED", state: "missing", accountableRole: "design-checklist-reviewer" })]);
    expect(decisionForIndependentReview("record_initiative_design_review", { implementation: completion([]), completion: terminal })).toBeNull();
    expect(decisionForIndependentReview("record_initiative_design_review", { completion: terminal })).toBeNull();
    expect(decisionForIndependentReview("record_initiative_design_review", { plan: terminal })?.unmet).toEqual(terminal.unmet);
  });
  it("routes only the missing baseline prerequisite of pre-delivery plan coverage", () => {
    const baseline = readinessRequirement({ code: "OBJECTIVE_BASELINE_REQUIRED", state: "missing", accountableRole: "design-checklist-reviewer" });
    const implementation = { ...completion([
      readinessRequirement({ code: "PLAN_REQUIRED", state: "missing", accountableRole: "implementation-planner" }),
    ]), target: "implementation" as const };
    const terminal = completion([baseline,
      readinessRequirement({ code: "ACCEPTANCE_EVIDENCE_REQUIRED", state: "missing", accountableRole: "acceptance-reviewer" }),
    ]);
    const decisions = { implementation, completion: terminal };
    expect(decisionForIndependentReview("record_initiative_design_review", decisions)).toMatchObject({
      target: "implementation", unmet: [baseline], blockers: [],
    });
    expect(decisionForIndependentReview("record_initiative_architecture_review", decisions)).toBeNull();
    expect(decisionForIndependentReview("record_initiative_design_review", { ...decisions,
      completion: completion([{ ...baseline, accountableRole: "product-owner" }]),
    })).toBeNull();
    expect(decisionForIndependentReview("record_initiative_design_review", { ...decisions,
      completion: completion([]),
    })).toBeNull();
  });
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

// BI-D9DECD1B: the archetype reviews are owed at IMPLEMENTATION and the claim
// issues their packets from that decision. The OAuth guard used to rebuild every
// non-design writer from the completion decision, so the claim's own packets
// were refused as "changed" and no archetype-profile item could reach
// implementation (BI-246AC135, WC-62AA177F, 2026-10-02).
describe("archetype review routing", () => {
  const archetype = (target: "implementation" | "completion") => ({
    ...completion([
      readinessRequirement({ code: "ARCHETYPE_PROVISIONING_INCOMPLETE", state: "missing", accountableRole: "archetype-steward" }),
      readinessRequirement({ code: "ARCHETYPE_COMPLETENESS_FAILED", state: "missing", accountableRole: "archetype-steward" }),
      readinessRequirement({ code: "REVIEW_REQUIRED", state: "missing", accountableRole: "security-reviewer" }),
    ]),
    target,
  });

  it("validates an archetype review against the implementation decision that owes it", () => {
    const terminal = completion([readinessRequirement({ code: "ACCEPTANCE_EVIDENCE_REQUIRED", state: "missing", accountableRole: "acceptance-reviewer" })]);
    const decision = decisionForIndependentReview("record_initiative_archetype_review", {
      implementation: archetype("implementation"),
      completion: terminal,
    });
    expect(decision?.target).toBe("implementation");
    expect(decision?.unmet.map((entry) => entry.code)).toEqual(["ARCHETYPE_PROVISIONING_INCOMPLETE", "ARCHETYPE_COMPLETENESS_FAILED"]);
  });

  it("falls back to the completion decision once implementation no longer owes them", () => {
    const terminal = archetype("completion");
    expect(decisionForIndependentReview("record_initiative_archetype_review", { implementation: completion([]), completion: terminal })).toBe(terminal);
  });
});
