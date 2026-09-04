import { describe, expect, it } from "vitest";

import {
  evaluateInitiativeReadiness,
  deriveAuthoritativeReadinessProfile,
  selectStrongestReadinessProfile,
  type InitiativeReadinessFacts,
  type ReadinessCode,
} from "./initiative-readiness";

const subject = { kind: "backlog-item" as const, id: "BI-FEATURE" };
const transitionObject = {
  kind: "backlog-item" as const,
  id: "BI-FEATURE",
  expectedVersion: "v1",
  targetState: "in-progress",
};

function facts(overrides: Partial<InitiativeReadinessFacts> = {}): InitiativeReadinessFacts {
  return {
    subject,
    transitionObject,
    profile: "feature",
    evaluatedAt: "2026-08-08T12:00:00.000Z",
    classification: "pass",
    canonicalDesign: "missing",
    research: "missing",
    specApproval: "missing",
    specialistReviews: {
      architecture: "missing",
      data: "missing",
      ux: "missing",
      security: "missing",
      compliance: "missing",
      domain: "not-applicable",
    },
    plan: "missing",
    planReview: "missing",
    planCoverage: "missing",
    dependencies: "missing",
    authorization: "pass",
    artifactAuthor: "pass",
    capsuleIdentity: "pass",
    deliveryEvidence: "missing",
    acceptanceEvidence: "missing",
    objectiveBaseline: "missing",
    objectiveReconciliation: "missing",
    archetypeProvisioning: {
      templateSubstrate: "not-applicable",
      professionCorpus: "not-applicable",
      coworkerDefinition: "not-applicable",
      skillsAndTools: "not-applicable",
    },
    archetypeCompleteness: "not-applicable",
    ...overrides,
  };
}

function codes(result: ReturnType<typeof evaluateInitiativeReadiness>): ReadinessCode[] {
  return [...result.unmet, ...result.blockers].map((entry) => entry.code);
}

describe("evaluateInitiativeReadiness", () => {
  it("applies materially different implementation floors by readiness profile", () => {
    const fix = evaluateInitiativeReadiness(facts({ profile: "fix", capsuleIdentity: "missing" }), "implementation");
    const feature = evaluateInitiativeReadiness(facts({
      profile: "feature",
      artifactAuthor: "missing",
      capsuleIdentity: "missing",
    }), "implementation");
    const crossDomain = evaluateInitiativeReadiness(facts({
      profile: "cross-domain",
      artifactAuthor: "missing",
      capsuleIdentity: "missing",
      specialistReviews: {
        architecture: "missing",
        data: "missing",
        ux: "missing",
        security: "missing",
        compliance: "missing",
        domain: "missing",
      },
    }), "implementation");

    const missingRoles = (decision: ReturnType<typeof evaluateInitiativeReadiness>, code: ReadinessCode) =>
      decision.unmet.filter((entry) => entry.code === code).map((entry) => entry.accountableRole);

    expect(codes(fix)).toEqual(expect.arrayContaining([
      "RESEARCH_REQUIRED",
      "PLAN_REQUIRED",
      "DEPENDENCY_UNRESOLVED",
      "CAPSULE_IDENTITY_MISMATCH",
    ]));
    expect(codes(fix)).toEqual(expect.not.arrayContaining([
      "CANONICAL_DESIGN_REQUIRED",
      "SPEC_APPROVAL_REQUIRED",
      "OBJECTIVE_BASELINE_REQUIRED",
      "PLAN_REVIEW_REQUIRED",
      "PLAN_COVERAGE_REQUIRED",
      "TRACEABILITY_INCOMPLETE",
      "ARTIFACT_AUTHOR_REQUIRED",
    ]));

    expect(codes(feature)).toEqual(expect.arrayContaining([
      "CANONICAL_DESIGN_REQUIRED",
      "SPEC_APPROVAL_REQUIRED",
      "OBJECTIVE_BASELINE_REQUIRED",
      "ARTIFACT_AUTHOR_REQUIRED",
      "PLAN_REVIEW_REQUIRED",
      "PLAN_COVERAGE_REQUIRED",
      "TRACEABILITY_INCOMPLETE",
    ]));
    expect(missingRoles(feature, "REVIEW_REQUIRED")).toEqual(["architecture-reviewer"]);

    expect(missingRoles(crossDomain, "REVIEW_REQUIRED")).toEqual([
      "architecture-reviewer",
      "data-reviewer",
      "ux-reviewer",
      "security-reviewer",
      "compliance-reviewer",
      "domain-reviewer",
    ]);
  });

  it("allows provisional feature capture only into design", () => {
    expect(evaluateInitiativeReadiness(facts(), "design")).toMatchObject({ verdict: "allowed" });
    expect(evaluateInitiativeReadiness(facts(), "plan")).toMatchObject({ verdict: "input-required" });
    expect(evaluateInitiativeReadiness(facts(), "implementation")).toMatchObject({ verdict: "input-required" });
    expect(evaluateInitiativeReadiness(facts(), "completion")).toMatchObject({ verdict: "input-required" });
  });

  it("allows planning after canonical approved design evidence", () => {
    const decision = evaluateInitiativeReadiness(facts({
      canonicalDesign: "pass",
      research: "pass",
      specApproval: "pass",
      specialistReviews: {
        architecture: "pass",
        data: "pass",
        ux: "pass",
        security: "pass",
        compliance: "pass",
        domain: "not-applicable",
      },
      objectiveBaseline: "pass",
    }), "plan");

    expect(decision.verdict).toBe("allowed");
    expect(decision.unmet).toEqual([]);
    expect(decision.blockers).toEqual([]);
  });

  it.each([
    ["malformed", "SPEC_APPROVAL_REQUIRED"],
    ["stale", "SPEC_APPROVAL_REQUIRED"],
    ["fail", "REVIEW_FAILED"],
  ] as const)("fails closed for %s current approval evidence", (state, code) => {
    const decision = evaluateInitiativeReadiness(facts({
      canonicalDesign: "pass",
      research: "pass",
      specApproval: state,
    }), "plan");

    expect(codes(decision)).toContain(code);
    expect(decision.verdict).not.toBe("allowed");
  });

  it("treats an explicit authorization denial and open findings as denied", () => {
    const decision = evaluateInitiativeReadiness(facts({
      authorization: "fail",
      blockingFindingsOpen: true,
    }), "completion");

    expect(decision.verdict).toBe("denied");
    expect(codes(decision)).toEqual(expect.arrayContaining([
      "AUTHORIZATION_DENIED",
      "BLOCKING_FINDINGS_OPEN",
    ]));
  });

  it("accepts not-applicable only on policy-permitted lenses", () => {
    const specialist = evaluateInitiativeReadiness(facts({
      canonicalDesign: "pass",
      research: "pass",
      specApproval: "pass",
      specialistReviews: {
        architecture: "not-applicable",
        data: "not-applicable",
        ux: "not-applicable",
        security: "not-applicable",
        compliance: "not-applicable",
        domain: "not-applicable",
      },
      objectiveBaseline: "pass",
    }), "plan");
    const classification = evaluateInitiativeReadiness(facts({ classification: "not-applicable" }), "design");

    expect(specialist.verdict).toBe("allowed");
    expect(classification.verdict).toBe("input-required");
    expect(codes(classification)).toContain("CLASSIFICATION_REQUIRED");
  });

  it("requires all four provisioning dimensions for an archetype", () => {
    const decision = evaluateInitiativeReadiness(facts({
      profile: "archetype",
      archetypeProvisioning: {
        templateSubstrate: "pass",
        professionCorpus: "missing",
        coworkerDefinition: "missing",
        skillsAndTools: "missing",
      },
      archetypeCompleteness: "missing",
    }), "implementation");

    expect(codes(decision)).toContain("ARCHETYPE_PROVISIONING_INCOMPLETE");
    expect(decision.verdict).toBe("input-required");
  });

  it("does not accept not-applicable as archetype provisioning or completeness evidence", () => {
    const decision = evaluateInitiativeReadiness(facts({
      profile: "archetype",
      archetypeProvisioning: {
        templateSubstrate: "not-applicable",
        professionCorpus: "not-applicable",
        coworkerDefinition: "not-applicable",
        skillsAndTools: "not-applicable",
      },
      archetypeCompleteness: "not-applicable",
    }), "implementation");

    expect(decision.verdict).toBe("input-required");
    expect(codes(decision)).toEqual(expect.arrayContaining([
      "ARCHETYPE_PROVISIONING_INCOMPLETE",
      "ARCHETYPE_COMPLETENESS_FAILED",
    ]));
  });

  it("requires baseline-bound delivery, acceptance, and objective reconciliation to complete", () => {
    const decision = evaluateInitiativeReadiness(facts({
      canonicalDesign: "pass",
      research: "pass",
      specApproval: "pass",
      specialistReviews: {
        architecture: "pass",
        data: "pass",
        ux: "pass",
        security: "pass",
        compliance: "pass",
        domain: "not-applicable",
      },
      plan: "pass",
      planReview: "pass",
      planCoverage: "pass",
      dependencies: "pass",
      objectiveBaseline: "pass",
      deliveryEvidence: "pass",
      acceptanceEvidence: "missing",
      objectiveReconciliation: "missing",
    }), "completion");

    expect(decision.verdict).toBe("input-required");
    expect(codes(decision)).toEqual(expect.arrayContaining([
      "ACCEPTANCE_EVIDENCE_REQUIRED",
      "OBJECTIVE_RECONCILIATION_REQUIRED",
    ]));
  });

  it("requires the exact active capsule identity before implementation begins", () => {
    const decision = evaluateInitiativeReadiness(facts({
      canonicalDesign: "pass",
      research: "pass",
      specApproval: "pass",
      specialistReviews: {
        architecture: "pass",
        data: "pass",
        ux: "pass",
        security: "pass",
        compliance: "pass",
        domain: "not-applicable",
      },
      plan: "pass",
      planReview: "pass",
      planCoverage: "pass",
      traceability: "pass",
      dependencies: "pass",
      objectiveBaseline: "pass",
      capsuleIdentity: "missing",
    }), "implementation");

    expect(decision.verdict).toBe("input-required");
    expect(codes(decision)).toContain("CAPSULE_IDENTITY_MISMATCH");
  });

  it("returns denied rather than allowed when the fact projection failed", () => {
    const decision = evaluateInitiativeReadiness(facts({ projectionError: true }), "design");

    expect(decision.verdict).toBe("denied");
    expect(codes(decision)).toContain("READINESS_PROJECTION_FAILED");
  });
});

describe("selectStrongestReadinessProfile", () => {
  it("is monotonic and cannot downgrade structured archetype evidence", () => {
    expect(selectStrongestReadinessProfile(["fix", "feature", "archetype"])).toBe("archetype");
    expect(selectStrongestReadinessProfile(["archetype", "doc-only"])).toBe("archetype");
  });

  it("derives the strongest structured or historical profile without permitting downgrade", () => {
    expect(deriveAuthoritativeReadinessProfile({
      type: "feature",
      scopeKind: "archetype",
      recordedProfiles: ["doc-only", "cross-domain"],
    })).toBe("archetype");
    expect(deriveAuthoritativeReadinessProfile({
      type: "bug",
      recordedProfiles: ["feature"],
    })).toBe("feature");
  });

  it("classifies a bounded platform-owned bug as fix without treating ownership as risk", () => {
    expect(deriveAuthoritativeReadinessProfile({
      type: "bug",
      scopeKind: "platform",
    })).toBe("fix");
    expect(deriveAuthoritativeReadinessProfile({
      type: "feature",
      scopeKind: "common",
    })).toBe("feature");
    expect(deriveAuthoritativeReadinessProfile({
      type: "bug",
      scopeKind: "platform",
      recordedProfiles: ["cross-domain"],
    })).toBe("cross-domain");
  });

  it.each([
    ["archetype-category", "archetype"],
    ["archetype-leaf", "archetype"],
    ["multi-archetype", "archetype"],
    ["cross-domain", "cross-domain"],
  ] as const)("maps canonical scopeKind %s to %s", (scopeKind, expected) => {
    expect(deriveAuthoritativeReadinessProfile({ type: "feature", scopeKind })).toBe(expected);
  });

  it.each([
    ["bug", "fix"],
    ["feature", "feature"],
    ["chore", "fix"],
    ["doc", "doc-only"],
    ["tool", "feature"],
    ["skill", "feature"],
    ["refactor", "feature"],
  ] as const)("maps closed backlog workType %s to readiness profile %s", (workType, expected) => {
    expect(deriveAuthoritativeReadinessProfile({ workType })).toBe(expected);
  });

  it("keeps unknown work types unclassified", () => {
    expect(deriveAuthoritativeReadinessProfile({ workType: "unknown-work" })).toBeNull();
  });
});
