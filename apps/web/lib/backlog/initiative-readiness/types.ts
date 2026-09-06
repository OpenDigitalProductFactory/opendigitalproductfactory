export const READINESS_TARGETS = ["design", "plan", "implementation", "completion"] as const;
export type ReadinessTarget = (typeof READINESS_TARGETS)[number];

export const READINESS_PROFILES = ["doc-only", "fix", "feature", "cross-domain", "archetype"] as const;
export type ReadinessProfile = (typeof READINESS_PROFILES)[number];

/**
 * Delivery shape — the fifth Workroom shape axis (design 2026-09-02 §3.0), the
 * key of the v3 requirement tables. `null`/absent means a pre-taxonomy item:
 * the v2 profile tables apply unchanged (kernel ruling 5).
 */
export const READINESS_SHAPES = ["break-fix", "small", "medium", "large", "xlarge"] as const;
export type ReadinessShape = (typeof READINESS_SHAPES)[number];

/** Risk axis (design §3.2). Raises the shape; never lowers it. */
export const READINESS_SENSITIVITIES = ["low", "elevated", "high"] as const;
export type ReadinessSensitivity = (typeof READINESS_SENSITIVITIES)[number];

export type ReadinessVerdict = "allowed" | "input-required" | "denied";

/**
 * Where a requirement's evidence actually lives, as opposed to whether it exists.
 * See `readiness-guidance.ts` for why the distinction is load-bearing
 * (BI-28E8CB88).
 */
export const READINESS_EVIDENCE_LANES = ["gate-receipt", "recorded-unread", "none"] as const;
export type ReadinessEvidenceLane = (typeof READINESS_EVIDENCE_LANES)[number];
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
  "STALE_EVIDENCE",
  "POST_IMPLEMENTATION_REVIEW_REQUIRED",
  "DECOMPOSITION_REQUIRED",
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
  /** Declared or derived delivery shape; absent for pre-taxonomy items. */
  shape?: ReadinessShape | null;
  sensitivity?: ReadinessSensitivity | null;
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
  /** break-fix only: the post-implementation review receipt (design §4, ruling 1). */
  postImplementationReview?: ReadinessEvidenceState;
  blockingFindingsOpen?: boolean;
  projectionError?: boolean;
  evidenceRefs?: Partial<Record<ReadinessCode, string[]>>;
  /**
   * Non-receipt activity IDs on the subject that could be an attempt at a
   * requirement this gate reads only from receipts (BI-28E8CB88).
   */
  unreadEvidenceRefs?: Partial<Record<ReadinessCode, string[]>>;
  /**
   * Reasons from a sub-policy that a single evidence state collapses — the
   * completion-evidence blockers behind a bare `DELIVERY_EVIDENCE_REQUIRED:
   * missing`, for instance.
   */
  requirementReasons?: Partial<Record<ReadinessCode, string[]>>;
};

export type ReadinessRequirementResult = {
  code: ReadinessCode;
  state: ReadinessEvidenceState | "blocked";
  accountableRole: string;
  evidenceRefs: string[];
  /**
   * Whether the evidence this requirement needs is absent, or present in a form
   * this gate does not read. `missing` alone reads as "you supplied nothing" to
   * a caller who supplied exactly what was asked for (BI-28E8CB88).
   */
  evidenceLane: ReadinessEvidenceLane;
  /** Activity IDs behind a `recorded-unread` lane. */
  unreadEvidenceRefs: string[];
  /** One actionable sentence, profile-aware. Null when nothing is owed. */
  nextAction: string | null;
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
