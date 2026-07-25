export const DECISION_PROFILE_KINDS = [
  "platform",
  "organization",
  "customer",
  "team",
  "persona-real",
  "persona-fictional",
  "persona-synthetic",
  "profession",
] as const;
export type DecisionPerspectiveProfileKind = typeof DECISION_PROFILE_KINDS[number];

export const DECISION_RISK_TIERS = ["low", "medium", "high", "critical"] as const;
export type DecisionRiskTier = typeof DECISION_RISK_TIERS[number];

export const DECISION_OUTCOME_TYPES = ["recommend", "arbitrate", "escalate", "defer"] as const;
export type DecisionOutcomeType = typeof DECISION_OUTCOME_TYPES[number];

// The governance gates that can produce a DecisionInteraction (BI-1BE30A9A).
// The audit tier derives from THIS, not from the resolved profile kind — a
// profession decision whose doctrine fell back to platform material is still a
// WSID decision. Closed registry: adding a gate means adding a tier mapping in
// lib/wiki/decision-audit.ts, which its round-trip test enforces.
// `backlog-triage` tiers as WWMD alongside `build-studio`: triage is a
// platform-doctrine call. It gets its own key rather than reusing build-studio
// so an operator scanning WWMD can distinguish an unattended hourly cron
// mutation from a human-initiated Build Studio phase advance — which is the
// whole reason the gate is recorded separately from the profile (BI-BB2E585C).
export const DECISION_GATE_KEYS = ["build-studio", "backlog-triage", "org-business", "profession"] as const;
export type DecisionGateKey = typeof DECISION_GATE_KEYS[number];

export const DECISION_DOMAIN_CLASSES = ["plan-readiness", "architecture-tradeoff", "risk-assessment", "professional-practice", "kernel-consult"] as const;
export type DecisionDomainClass = typeof DECISION_DOMAIN_CLASSES[number];
export const PLAN_READINESS_DOMAIN_CLASS = "plan-readiness" satisfies DecisionDomainClass;

export const PERSPECTIVE_MATERIAL_FRESHNESS = ["current", "stale", "superseded", "contradicted"] as const;
export type PerspectiveMaterialFreshness = typeof PERSPECTIVE_MATERIAL_FRESHNESS[number];

export const PERSPECTIVE_EVIDENCE_GRADES = ["A", "B", "C", "D"] as const;
export type PerspectiveEvidenceGrade = typeof PERSPECTIVE_EVIDENCE_GRADES[number];

export const PERSPECTIVE_REVIEW_STATUSES = ["draft", "approved", "rejected"] as const;
export type PerspectiveReviewStatus = typeof PERSPECTIVE_REVIEW_STATUSES[number];

export const PERSPECTIVE_PROMOTION_STATES = ["candidate", "promoted", "revoked"] as const;
export type PerspectivePromotionState = typeof PERSPECTIVE_PROMOTION_STATES[number];

export type DecisionPerspectiveScope = {
  domains: string[];
  routes?: string[];
  products?: string[];
  riskTiers?: DecisionRiskTier[];
  professionKey?: string;
  roles?: string[];
};

export type DecisionResolverRule = {
  type: "build-studio-owner" | "principal" | "role" | "manual";
  principalId?: string;
  role?: string;
};

export type DecisionAutonomyPolicy = {
  allowRecommendation: boolean;
  allowArbitration: boolean;
  maxRiskForArbitration: DecisionRiskTier;
  minimumConfidenceForRecommendation: number;
  minimumConfidenceForArbitration: number;
};

export type DecisionPerspectiveProfileVersion = {
  versionId: string;
  versionNumber: number;
  materialFingerprint: string;
  changeSummary: string;
  createdAt: Date;
};

export type DecisionPerspectiveProfile = {
  profileId: string;
  name: string;
  kind: DecisionPerspectiveProfileKind;
  scope: DecisionPerspectiveScope;
  fallbackProfileId: string | null;
  defaultResolver: DecisionResolverRule;
  autonomyPolicy: DecisionAutonomyPolicy;
  currentVersion: DecisionPerspectiveProfileVersion;
};

export type PerspectiveMaterial = {
  materialId: string;
  profileId: string;
  sourceType: string;
  sourceRef: Record<string, unknown>;
  summary: string;
  domainClass: DecisionDomainClass;
  direction: "support" | "oppose" | "neutral";
  domains: string[];
  freshness: PerspectiveMaterialFreshness;
  evidenceGrade: PerspectiveEvidenceGrade;
  confidenceWeight: number;
  principleDirection?: "support" | "oppose" | "neutral";
  reviewStatus: PerspectiveReviewStatus;
  promotionState: PerspectivePromotionState;
  lastValidatedAt: Date | null;
};

export type DecisionEvidenceItem = {
  label: string;
  sourceType: string;
  grade: PerspectiveEvidenceGrade;
  summary: string;
};

export type PerspectiveMaterialScore = {
  materialId: string;
  profileId: string;
  sourceType: string;
  freshness: PerspectiveMaterialFreshness;
  confidenceWeight: number;
  freshnessFactor: number;
  evidenceFactor: number;
  reviewFactor: number;
  promotionFactor: number;
  effectiveWeight: number;
  exclusionReason: "contradicted" | "superseded" | "rejected" | "revoked" | null;
};

/**
 * A scored decision option, matching option-scoring.ts's DecisionOption shape
 * (BI-D88DFEEA Phase 1). Gates with a small, closed option menu (build-studio
 * plan-advancement, work-pattern-review) can supply this alongside `options`
 * so the gate records which option the kernel would recommend and, later,
 * which one the human actually chose — the raw material weight-inference.ts's
 * adapter needs. Optional and additive: gates that don't supply it behave
 * exactly as before.
 */
export type DecisionScoredOption = {
  id: string;
  description: string;
  features: Record<string, number>;
};

export type DecisionPerspectiveEvaluationInput = {
  profile: DecisionPerspectiveProfile;
  fallbackProfiles?: DecisionPerspectiveProfile[];
  materials: PerspectiveMaterial[];
  question: string;
  questionDomain: DecisionDomainClass;
  options: string[];
  /** See DecisionScoredOption. When supplied, must correspond 1:1 with `options`. */
  scoredOptions?: DecisionScoredOption[];
  riskTier: DecisionRiskTier;
  evidence?: DecisionEvidenceItem[];
  recentOverrideCount?: number;
};

export type DecisionPerspectiveEvaluationResult = {
  outcomeType: DecisionOutcomeType;
  selectedProfileId: string;
  fallbackProfileId: string | null;
  profileVersionId: string;
  confidenceBefore: number;
  confidenceAfter: number;
  confidenceScore: number;
  coverageGap: boolean;
  principleConflict: boolean;
  domainClass: DecisionDomainClass;
  resolvedProfileChain: string[];
  materialCount: number;
  freshnessDistribution: Record<PerspectiveMaterialFreshness, number>;
  riskTier: DecisionRiskTier;
  question: string;
  options: string[];
  /** Echoes the input when supplied; carried through to persistence. */
  scoredOptions?: DecisionScoredOption[];
  /**
   * The id of the option decide() picked as argmax when `scoredOptions` was
   * supplied and outcomeType ended up "recommend"/"arbitrate" (BI-D88DFEEA
   * Phase 1). Null when no scored options were given, when decide() reported
   * insufficient signal, or when the gate escalated/deferred instead of
   * recommending a path forward.
   */
  recommendedOptionId?: string | null;
  rationale: string;
  materialScores: PerspectiveMaterialScore[];
  sources: Array<{
    materialId: string;
    sourceType: string;
    summary: string;
    effectiveWeight: number;
  }>;
  gapReason?: "no-applicable-material" | "material-below-confidence";
};

export type DecisionInteractionGateView = {
  interactionId: string;
  profileId: string;
  profileVersionId: string;
  domainClass: DecisionDomainClass;
  outcomeType: DecisionOutcomeType;
  confidenceBefore: number | null;
  confidenceAfter: number | null;
  confidenceScore: number;
  materialCount: number;
  principleConflict: boolean;
  rationale: string | null;
  createdAt: Date;
  sources: DecisionPerspectiveEvaluationResult["sources"];
  // BI-6DCF772F: the scored option menu (when the gate scored one), the kernel's
  // recommendation, and any already-captured human pick — so the capture form
  // can offer a structured choice that populates chosenOptionId.
  scoredOptions: DecisionScoredOption[] | null;
  recommendedOptionId: string | null;
  chosenOptionId: string | null;
  escalationCaptured: boolean;
  deferralCaptured: boolean;
};
