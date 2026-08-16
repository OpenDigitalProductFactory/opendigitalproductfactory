export const READINESS_TARGETS = ["design", "plan", "implementation", "completion"] as const;
export type ReadinessTarget = (typeof READINESS_TARGETS)[number];

export const READINESS_PROFILES = ["doc-only", "fix", "feature", "cross-domain", "archetype"] as const;
export type ReadinessProfile = (typeof READINESS_PROFILES)[number];

export type ReadinessVerdict = "allowed" | "input-required" | "denied";
export type ReadinessEvidenceState =
  | "pass"
  | "fail"
  | "missing"
  | "malformed"
  | "stale"
  | "not-applicable";

export const READINESS_CODES = [
  "CLASSIFICATION_REQUIRED",
  "CANONICAL_DESIGN_REQUIRED",
  "RESEARCH_REQUIRED",
  "SPEC_APPROVAL_REQUIRED",
  "CANONICAL_DESIGN_AMBIGUOUS",
  "REVIEW_REQUIRED",
  "REVIEW_FAILED",
  "BLOCKING_FINDINGS_OPEN",
  "PLAN_REQUIRED",
  "PLAN_REVIEW_REQUIRED",
  "PLAN_COVERAGE_REQUIRED",
  "TRACEABILITY_INCOMPLETE",
  "DEPENDENCY_UNRESOLVED",
  "AUTHORIZATION_DENIED",
  "ARTIFACT_AUTHOR_REQUIRED",
  "CAPSULE_IDENTITY_MISMATCH",
  "DELIVERY_EVIDENCE_REQUIRED",
  "ACCEPTANCE_EVIDENCE_REQUIRED",
  "OBJECTIVE_RECONCILIATION_REQUIRED",
  "OBJECTIVE_BASELINE_REQUIRED",
  "OBJECTIVE_BASELINE_CONFLICT",
  "ARCHETYPE_PROVISIONING_INCOMPLETE",
  "ARCHETYPE_COMPLETENESS_FAILED",
  "READINESS_PROJECTION_FAILED",
] as const;

export type ReadinessCode = (typeof READINESS_CODES)[number];

export type InitiativeSubject = {
  kind: "backlog-item" | "epic" | "feature-build" | "task-run";
  id: string;
};

export type InitiativeTransitionObject = {
  kind: "backlog-item" | "epic" | "feature-build" | "work-capsule" | "task-run";
  id: string;
  expectedVersion: string;
  targetState: string;
};

export type SpecialistReadinessFacts = {
  architecture: ReadinessEvidenceState;
  data: ReadinessEvidenceState;
  ux: ReadinessEvidenceState;
  security: ReadinessEvidenceState;
  compliance: ReadinessEvidenceState;
  domain: ReadinessEvidenceState;
};

export type ArchetypeProvisioningFacts = {
  templateSubstrate: ReadinessEvidenceState;
  professionCorpus: ReadinessEvidenceState;
  coworkerDefinition: ReadinessEvidenceState;
  skillsAndTools: ReadinessEvidenceState;
};

export type InitiativeReadinessFacts = {
  decisionId?: string;
  policyVersion?: string;
  subject: InitiativeSubject;
  transitionObject: InitiativeTransitionObject;
  profile: ReadinessProfile;
  evaluatedAt: string;
  classification: ReadinessEvidenceState;
  canonicalDesign: ReadinessEvidenceState;
  canonicalDesignAmbiguous?: boolean;
  research: ReadinessEvidenceState;
  specApproval: ReadinessEvidenceState;
  specialistReviews: SpecialistReadinessFacts;
  plan: ReadinessEvidenceState;
  planReview: ReadinessEvidenceState;
  planCoverage: ReadinessEvidenceState;
  traceability?: ReadinessEvidenceState;
  dependencies: ReadinessEvidenceState;
  authorization: ReadinessEvidenceState;
  artifactAuthor: ReadinessEvidenceState;
  capsuleIdentity: ReadinessEvidenceState;
  deliveryEvidence: ReadinessEvidenceState;
  acceptanceEvidence: ReadinessEvidenceState;
  objectiveBaseline: ReadinessEvidenceState;
  objectiveBaselineConflict?: boolean;
  objectiveReconciliation: ReadinessEvidenceState;
  archetypeProvisioning: ArchetypeProvisioningFacts;
  archetypeCompleteness: ReadinessEvidenceState;
  blockingFindingsOpen?: boolean;
  projectionError?: boolean;
  evidenceRefs?: Partial<Record<ReadinessCode, string[]>>;
};

export type ReadinessRequirementResult = {
  code: ReadinessCode;
  state: ReadinessEvidenceState | "blocked";
  accountableRole: string;
  evidenceRefs: string[];
};

export type InitiativeReadinessDecision = {
  decisionId: string;
  policyVersion: string;
  subject: InitiativeSubject;
  transitionObject: InitiativeTransitionObject;
  profile: ReadinessProfile;
  target: ReadinessTarget;
  verdict: ReadinessVerdict;
  satisfied: ReadinessRequirementResult[];
  unmet: ReadinessRequirementResult[];
  blockers: ReadinessRequirementResult[];
  evaluatedAt: string;
};
