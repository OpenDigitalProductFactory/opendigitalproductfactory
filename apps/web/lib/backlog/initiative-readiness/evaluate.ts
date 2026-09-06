import { requirementEvidenceLane, requirementNextAction } from "./readiness-guidance";
import type {
  InitiativeReadinessDecision,
  InitiativeReadinessFacts,
  ReadinessCode,
  ReadinessEvidenceState,
  ReadinessRequirementResult,
  ReadinessTarget,
} from "./types";

export const INITIATIVE_READINESS_POLICY_VERSION = "initiative-readiness.v2";

type Requirement = {
  code: ReadinessCode;
  state: ReadinessEvidenceState;
  accountableRole: string;
  failCode?: ReadinessCode;
  allowNotApplicable?: boolean;
};

function requirement(
  code: ReadinessCode,
  state: ReadinessEvidenceState,
  accountableRole: string,
  failCode?: ReadinessCode,
  allowNotApplicable = false,
): Requirement {
  return { code, state, accountableRole, failCode, allowNotApplicable };
}

function designRequirements(facts: InitiativeReadinessFacts): Requirement[] {
  return [
    requirement("CLASSIFICATION_REQUIRED", facts.classification, "product-owner"),
    requirement("AUTHORIZATION_DENIED", facts.authorization, "platform-governance"),
  ];
}

function planRequirements(facts: InitiativeReadinessFacts): Requirement[] {
  const specialist = facts.specialistReviews;
  const common = designRequirements(facts);
  if (facts.profile === "doc-only") return common;

  const fix = [
    ...common,
    requirement("RESEARCH_REQUIRED", facts.research, "design-author"),
  ];
  if (facts.profile === "fix") return fix;

  const feature = [
    ...fix,
    requirement("CANONICAL_DESIGN_REQUIRED", facts.canonicalDesign, "design-checklist-reviewer"),
    requirement("SPEC_APPROVAL_REQUIRED", facts.specApproval, "design-checklist-reviewer", "REVIEW_FAILED"),
    requirement("REVIEW_REQUIRED", specialist.architecture, "architecture-reviewer", "REVIEW_FAILED", true),
    requirement("OBJECTIVE_BASELINE_REQUIRED", facts.objectiveBaseline, "design-checklist-reviewer"),
    requirement("ARTIFACT_AUTHOR_REQUIRED", facts.artifactAuthor, "artifact-resolver"),
  ];
  if (facts.profile === "feature") return feature;

  return [
    ...feature,
    requirement("REVIEW_REQUIRED", specialist.data, "data-reviewer", "REVIEW_FAILED", true),
    requirement("REVIEW_REQUIRED", specialist.ux, "ux-reviewer", "REVIEW_FAILED", true),
    requirement("REVIEW_REQUIRED", specialist.security, "security-reviewer", "REVIEW_FAILED", true),
    requirement("REVIEW_REQUIRED", specialist.compliance, "compliance-reviewer", "REVIEW_FAILED", true),
    requirement("REVIEW_REQUIRED", specialist.domain, "domain-reviewer", "REVIEW_FAILED", true),
  ];
}

function implementationRequirements(facts: InitiativeReadinessFacts): Requirement[] {
  const requirements = [...planRequirements(facts)];
  if (facts.profile !== "doc-only") {
    requirements.push(
      requirement("PLAN_REQUIRED", facts.plan, "implementation-planner"),
      requirement("DEPENDENCY_UNRESOLVED", facts.dependencies, "portfolio-management", undefined, true),
      requirement("CAPSULE_IDENTITY_MISMATCH", facts.capsuleIdentity, "delivery-coordinator"),
    );
  }
  if (["feature", "cross-domain", "archetype"].includes(facts.profile)) {
    requirements.push(
      requirement("PLAN_REVIEW_REQUIRED", facts.planReview, "plan-reviewer", "REVIEW_FAILED"),
      requirement("PLAN_COVERAGE_REQUIRED", facts.planCoverage, "portfolio-management"),
      requirement("TRACEABILITY_INCOMPLETE", facts.traceability ?? facts.planCoverage, "portfolio-management"),
    );
  }
  if (facts.profile === "archetype") {
    const provisioningStates = Object.values(facts.archetypeProvisioning);
    const provisioningState: ReadinessEvidenceState = provisioningStates.some((state) => state === "fail")
      ? "fail"
      : provisioningStates.every((state) => state === "pass")
        ? "pass"
        : "missing";
    requirements.push(requirement(
      "ARCHETYPE_PROVISIONING_INCOMPLETE",
      provisioningState,
      "archetype-steward",
      "ARCHETYPE_COMPLETENESS_FAILED",
    ));
    requirements.push(requirement(
      "ARCHETYPE_COMPLETENESS_FAILED",
      facts.archetypeCompleteness === "not-applicable" ? "missing" : facts.archetypeCompleteness,
      "archetype-steward",
    ));
  }
  return requirements;
}

function completionRequirements(facts: InitiativeReadinessFacts): Requirement[] {
  const requirements = [
    ...implementationRequirements(facts),
    requirement("DELIVERY_EVIDENCE_REQUIRED", facts.deliveryEvidence, "delivery-coordinator"),
    requirement("ACCEPTANCE_EVIDENCE_REQUIRED", facts.acceptanceEvidence, "acceptance-reviewer"),
  ];
  if (facts.profile !== "doc-only") {
    requirements.push(
      requirement("OBJECTIVE_BASELINE_REQUIRED", facts.objectiveBaseline, "design-checklist-reviewer"),
      requirement("OBJECTIVE_RECONCILIATION_REQUIRED", facts.objectiveReconciliation, "acceptance-reviewer"),
    );
  }
  return requirements;
}

function requirementsFor(facts: InitiativeReadinessFacts, target: ReadinessTarget): Requirement[] {
  if (target === "design") return designRequirements(facts);
  if (target === "plan") return planRequirements(facts);
  if (target === "implementation") return implementationRequirements(facts);
  return completionRequirements(facts);
}

/**
 * BI-28E8CB88: a requirement result used to carry only a state and a code. That
 * is enough to decide the verdict and not enough to act on: `missing` with an
 * empty ref list reads as "you supplied nothing" to an author who supplied
 * exactly what was asked for, in the lane nothing reads. Every result now says
 * which lane its evidence is in and names the door for THIS profile
 * (BI-3AE38A1F). The verdict arithmetic above is untouched — nothing here can
 * turn an unmet requirement into a satisfied one.
 */
function result(
  facts: InitiativeReadinessFacts,
  code: ReadinessCode,
  state: ReadinessEvidenceState | "blocked",
  accountableRole: string,
): ReadinessRequirementResult {
  const unreadEvidenceRefs = state === "pass" ? [] : facts.unreadEvidenceRefs?.[code] ?? [];
  return {
    code,
    state,
    accountableRole,
    evidenceRefs: facts.evidenceRefs?.[code] ?? [],
    evidenceLane: requirementEvidenceLane({ state, unreadEvidenceRefs }),
    unreadEvidenceRefs,
    nextAction: requirementNextAction({
      code,
      profile: facts.profile,
      state,
      unreadEvidenceRefs,
      reasons: facts.requirementReasons?.[code],
    }),
  };
}

/** Pure policy evaluation. All I/O, identity resolution, persistence, and rendering stay in adapters. */
export function evaluateInitiativeReadiness(
  facts: InitiativeReadinessFacts,
  target: ReadinessTarget,
): InitiativeReadinessDecision {
  const satisfied: ReadinessRequirementResult[] = [];
  const unmet: ReadinessRequirementResult[] = [];
  const blockers: ReadinessRequirementResult[] = [];

  if (facts.projectionError) {
    blockers.push(result(facts, "READINESS_PROJECTION_FAILED", "blocked", "platform-governance"));
  }
  if (facts.canonicalDesignAmbiguous) {
    blockers.push(result(facts, "CANONICAL_DESIGN_AMBIGUOUS", "blocked", "design-checklist-reviewer"));
  }
  if (facts.objectiveBaselineConflict) {
    blockers.push(result(facts, "OBJECTIVE_BASELINE_CONFLICT", "blocked", "acceptance-reviewer"));
  }
  if (facts.blockingFindingsOpen) {
    blockers.push(result(facts, "BLOCKING_FINDINGS_OPEN", "blocked", "review-owner"));
  }

  const seen = new Set<string>();
  for (const entry of requirementsFor(facts, target)) {
    const identity = `${entry.code}:${entry.accountableRole}`;
    if (seen.has(identity)) continue;
    seen.add(identity);
    if (entry.state === "pass" || (entry.state === "not-applicable" && entry.allowNotApplicable)) {
      satisfied.push(result(facts, entry.code, entry.state, entry.accountableRole));
      continue;
    }
    if (entry.state === "fail") {
      blockers.push(result(facts, entry.failCode ?? entry.code, entry.state, entry.accountableRole));
      continue;
    }
    unmet.push(result(facts, entry.code, entry.state, entry.accountableRole));
  }

  return {
    decisionId: facts.decisionId ?? "unpersisted",
    policyVersion: facts.policyVersion ?? INITIATIVE_READINESS_POLICY_VERSION,
    subject: facts.subject,
    transitionObject: facts.transitionObject,
    profile: facts.profile,
    target,
    verdict: blockers.length > 0 ? "denied" : unmet.length > 0 ? "input-required" : "allowed",
    satisfied,
    unmet,
    blockers,
    evaluatedAt: facts.evaluatedAt,
  };
}
