import { describe, expect, it } from "vitest";

import { evaluateInitiativeReadiness } from "./evaluate";
import { effectiveShape } from "./shape-requirements";
import type { InitiativeReadinessFacts, ReadinessCode } from "./types";

const subject = { kind: "backlog-item" as const, id: "BI-SHAPED" };
const transitionObject = { kind: "backlog-item" as const, id: "BI-SHAPED", expectedVersion: "v1", targetState: "in-progress" };

function facts(overrides: Partial<InitiativeReadinessFacts> = {}): InitiativeReadinessFacts {
  return {
    subject,
    transitionObject,
    profile: "feature",
    evaluatedAt: "2026-09-06T12:00:00.000Z",
    classification: "pass",
    canonicalDesign: "missing",
    research: "missing",
    specApproval: "missing",
    specialistReviews: { architecture: "missing", data: "missing", ux: "missing", security: "missing", compliance: "missing", domain: "not-applicable" },
    plan: "missing",
    planReview: "missing",
    planCoverage: "missing",
    dependencies: "not-applicable",
    authorization: "pass",
    artifactAuthor: "missing",
    capsuleIdentity: "pass",
    deliveryEvidence: "missing",
    acceptanceEvidence: "missing",
    objectiveBaseline: "missing",
    objectiveReconciliation: "missing",
    archetypeProvisioning: { templateSubstrate: "not-applicable", professionCorpus: "not-applicable", coworkerDefinition: "not-applicable", skillsAndTools: "not-applicable" },
    archetypeCompleteness: "not-applicable",
    ...overrides,
  };
}

const codes = (decision: ReturnType<typeof evaluateInitiativeReadiness>): ReadinessCode[] =>
  [...decision.unmet, ...decision.blockers].map((entry) => entry.code);

describe("initiative-readiness.v3 — gates keyed by (shape, sensitivity, target)", () => {
  it("small + low completes on delivery plus a runtime check, with no spec, plan or reconciliation", () => {
    const done = evaluateInitiativeReadiness(
      facts({ shape: "small", sensitivity: "low", research: "pass", deliveryEvidence: "pass", acceptanceEvidence: "pass" }),
      "completion",
    );
    expect(done.verdict).toBe("allowed");
    expect(done.policyVersion).toBe("initiative-readiness.v3");
    const owed = codes(evaluateInitiativeReadiness(facts({ shape: "small", sensitivity: "low", research: "pass" }), "completion"));
    expect(owed).toEqual(["DELIVERY_EVIDENCE_REQUIRED", "ACCEPTANCE_EVIDENCE_REQUIRED"]);
    expect(owed).not.toContain("SPEC_APPROVAL_REQUIRED");
    expect(owed).not.toContain("PLAN_REQUIRED");
    expect(owed).not.toContain("OBJECTIVE_RECONCILIATION_REQUIRED");
  });

  it("small implementation owes only research and the capsule identity", () => {
    expect(codes(evaluateInitiativeReadiness(facts({ shape: "small" }), "implementation"))).toEqual(["RESEARCH_REQUIRED"]);
    expect(evaluateInitiativeReadiness(facts({ shape: "small", research: "pass" }), "implementation").verdict).toBe("allowed");
  });

  it("medium owes an item-body baseline and an independent acceptance receipt (ruling 3)", () => {
    const plan = evaluateInitiativeReadiness(facts({ shape: "medium", research: "pass" }), "plan");
    expect(codes(plan)).toEqual(["OBJECTIVE_BASELINE_REQUIRED"]);
    expect(plan.unmet[0]?.nextAction).toMatch(/item body/);
    const done = evaluateInitiativeReadiness(
      facts({ shape: "medium", research: "pass", objectiveBaseline: "pass", deliveryEvidence: "pass" }),
      "completion",
    );
    expect(codes(done)).toEqual(["ACCEPTANCE_EVIDENCE_REQUIRED"]);
    expect(done.unmet[0]?.accountableRole).toBe("acceptance-reviewer");
    expect(done.unmet[0]?.nextAction).toMatch(/independent acceptance/);
  });

  it("small + high sensitivity owes the large gates (ruling 4)", () => {
    const owed = codes(evaluateInitiativeReadiness(facts({ shape: "small", sensitivity: "high", research: "pass" }), "implementation"));
    expect(owed).toEqual(expect.arrayContaining(["SPEC_APPROVAL_REQUIRED", "PLAN_REQUIRED", "PLAN_REVIEW_REQUIRED", "PLAN_COVERAGE_REQUIRED"]));
    expect(effectiveShape("small", "high")).toBe("large");
    expect(effectiveShape("medium", "high")).toBe("large");
    expect(effectiveShape("small", "elevated")).toBe("medium");
    expect(effectiveShape("medium", "elevated")).toBe("large");
    expect(effectiveShape("break-fix", "high")).toBe("break-fix");
    expect(effectiveShape("large", "low")).toBe("large");
  });

  it("a pre-taxonomy item with no shape keeps the v2 profile behaviour (ruling 5)", () => {
    const unshaped = evaluateInitiativeReadiness(facts({ shape: null, profile: "fix", research: "pass", plan: "pass" }), "implementation");
    expect(unshaped.verdict).toBe("allowed");
    const feature = codes(evaluateInitiativeReadiness(facts({ shape: undefined }), "implementation"));
    expect(feature).toEqual(expect.arrayContaining(["RESEARCH_REQUIRED", "CANONICAL_DESIGN_REQUIRED", "SPEC_APPROVAL_REQUIRED", "PLAN_REQUIRED"]));
  });

  it("break-fix skips pre-authorisation and owes a post-implementation review receipt (ruling 1)", () => {
    expect(evaluateInitiativeReadiness(facts({ shape: "break-fix" }), "implementation").verdict).toBe("allowed");
    const owed = evaluateInitiativeReadiness(facts({ shape: "break-fix", deliveryEvidence: "pass" }), "completion");
    expect(codes(owed)).toEqual(["POST_IMPLEMENTATION_REVIEW_REQUIRED"]);
    expect(owed.unmet[0]?.nextAction).toMatch(/48 hours/);
    expect(evaluateInitiativeReadiness(facts({ shape: "break-fix", deliveryEvidence: "pass", postImplementationReview: "pass" }), "completion").verdict).toBe("allowed");
    const failed = evaluateInitiativeReadiness(facts({ shape: "break-fix", deliveryEvidence: "pass", postImplementationReview: "fail" }), "completion");
    expect(failed.verdict).toBe("denied");
    expect(failed.blockers.map((entry) => entry.code)).toContain("REVIEW_FAILED");
  });

  it("large keeps every feature gate and xlarge never enters implementation", () => {
    const large = codes(evaluateInitiativeReadiness(facts({ shape: "large" }), "completion"));
    expect(large).toEqual(expect.arrayContaining(["SPEC_APPROVAL_REQUIRED", "PLAN_COVERAGE_REQUIRED", "OBJECTIVE_RECONCILIATION_REQUIRED"]));
    const xlarge = evaluateInitiativeReadiness(
      facts({ shape: "xlarge", research: "pass", canonicalDesign: "pass", specApproval: "pass", objectiveBaseline: "pass", artifactAuthor: "pass", specialistReviews: { architecture: "pass", data: "not-applicable", ux: "not-applicable", security: "not-applicable", compliance: "not-applicable", domain: "not-applicable" } }),
      "implementation",
    );
    expect(xlarge.verdict).toBe("denied");
    expect(xlarge.blockers.map((entry) => entry.code)).toContain("DECOMPOSITION_REQUIRED");
    expect(xlarge.blockers.find((entry) => entry.code === "DECOMPOSITION_REQUIRED")?.nextAction).toMatch(/Decompose/);
  });
});
