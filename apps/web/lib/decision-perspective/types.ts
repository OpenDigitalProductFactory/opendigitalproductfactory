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

// BI-2107B5D2: "decline" is an ASSURANCE, not a failure to decide — the gate
// weighed the question and the answer is no, with a named cause. Before this
// existed a decisive no was indistinguishable from "could not be weighed".
export const DECISION_OUTCOME_TYPES = ["recommend", "arbitrate", "escalate", "defer", "decline"] as const;
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
// `kernel-consult` is the MCP `principle_decide` door (external agents +
// coworkers). It is WWMD platform doctrine, but a distinct door so operators
// can measure external-agent adoption separately from Build Studio / triage
// (BI-FD7CBA06).
export const DECISION_GATE_KEYS = [
  "build-studio",
  "backlog-triage",
  "kernel-consult",
  "org-business",
  "profession",
] as const;
export type DecisionGateKey = typeof DECISION_GATE_KEYS[number];

export const DECISION_DOMAIN_CLASSES = ["plan-readiness", "architecture-tradeoff", "risk-assessment", "professional-practice", "kernel-consult"] as const;
export type DecisionDomainClass = typeof DECISION_DOMAIN_CLASSES[number];

/**
 * Topic tag on `PerspectiveMaterial.domains` marking material that governs every
 * business domain class rather than one bucket (BI-F5F2869D). Lives here, on the
 * shared leaf, so `material.ts` (which reads it) and `stance-promotion.ts`
 * (which writes it) need no import between them.
 */
export const CROSS_DOMAIN_MATERIAL_TAG = "all-business-domains";
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
  /**
   * Per-material relevance ∈ [0,1] to `question` (BI-7E1F128A), keyed by
   * materialId. Computed async upstream (semantic embeddings with lexical
   * fallback) and passed into this synchronous evaluator so scoring is
   * content-aware without the evaluator itself doing IO. When omitted, every
   * applicable material is treated as fully relevant (legacy coverage-only
   * behaviour).
   */
  relevanceByMaterialId?: Map<string, number>;
  /** How `relevanceByMaterialId` was computed, echoed onto the result. */
  relevanceMethod?: "semantic" | "lexical";
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
  /**
   * Net directional pull of the stance material that is RELEVANT to this
   * question (BI-7E1F128A), in [-1, 1]: +1 = the relevant stance wholly supports
   * the decision, -1 = it wholly opposes it, 0 = no directional signal or a
   * support/oppose conflict. Undefined on the legacy coverage-only path.
   */
  alignmentScore?: number;
  /**
   * The directional verdict derived from `alignmentScore`: `approve` when the
   * org's relevant stance supports the decision, `decline` when it opposes it,
   * `mixed` when relevant support and oppose material conflict, `none` when no
   * relevant stance speaks to it.
   */
  stanceAlignment?: "approve" | "decline" | "mixed" | "none";
  /** How question↔stance relevance was computed for this evaluation. */
  relevanceMethod?: "semantic" | "lexical";
  /** Independent corpus checks; any rejected hard boundary vetoes aggregation. */
  constitutionalAlignment?: import("./alignment-criteria").ConstitutionalAlignmentResult;
  rationale: string;
  materialScores: PerspectiveMaterialScore[];
  sources: Array<DecisionEvaluationSource>;
  gapReason?:
    | "no-applicable-material"
    | "material-below-confidence"
    // BI-F5F2869D: not a gap at all — recorded doctrine is consistent with the
    // proposal, but nobody has ruled on this question, so it goes to the owner
    // as a NEW idea to weigh rather than as missing policy.
    | "aligned-not-settled"
    // EP-5CC9C184 / BI-5843CD9C: the material present CANNOT reach the
    // recommendation band no matter how much more of the same kind is added,
    // because its weighting ceiling sits below the band. Distinct from
    // "material-below-confidence", which more or better material can fix.
    | "ceiling-below-recommendation-band";
  /**
   * Why this consult could or could not have recommended, independent of what it
   * decided. Present whenever applicable material was scored.
   *
   * Without this, a consult that is arithmetically incapable of recommending is
   * indistinguishable from one that weighed the evidence and chose to escalate —
   * both return an escalation with a plausible rationale. Callers then treat an
   * inert mechanism as a considered judgement, and operators add material that
   * cannot possibly help. Measured live under BI-0F3D5F94: five acumens holding
   * 3 to 12 material rows all returned exactly 0.35 at medium risk.
   */
  decidability?: MaterialDecidability;
};

/**
 * Whether the scored material could clear the recommendation band at all, and
 * what is holding the ceiling down when it cannot.
 */
export type MaterialDecidability = {
  /** Highest confidence this material set could reach at this risk tier. */
  ceiling: number;
  /** The band the ceiling is measured against. */
  recommendationBand: number;
  /** False when ceiling < band — more material of the same kind cannot help. */
  canReachRecommendation: boolean;
  /**
   * The weighting factor capping the ceiling, when one dominates. `promotion`
   * is the common case for seeded doctrine: candidate material is weighted 0.45,
   * so it cannot reach a 0.7 band however much of it exists — only promotion
   * moves it. `freshness` and `review` are operator-fixable by curation;
   * `evidence` needs better sources, not more of them.
   */
  bindingFactor: "promotion" | "freshness" | "review" | "evidence" | "confidence" | null;
  /** Plain-language remedy naming what would actually change the outcome. */
  remedy: string | null;
};

/**
 * One cited source on a recorded decision.
 *
 * The first four fields are the original contract (every gate populates them).
 * The rest are the trust-envelope re-verification fields (BI-8192557E phase 2a):
 * before them only `sourceType` — a bare string — survived the write, so a
 * recorded citation could be proven un-tampered-with (via the sealed
 * `evidenceDigests` hash chain) but never re-resolved against live source. A
 * digest cannot answer "was this citation ever TRUE"; the structured locator can.
 *
 * All five are optional and additive: rows written before this carry none of
 * them, and their absence must read as UNVERIFIABLE — never as confirmed
 * (see `recordedCitationsFromSources`).
 */
export type DecisionEvaluationSource = {
  materialId: string;
  sourceType: string;
  summary: string;
  effectiveWeight: number;
  /** Structured locator, re-resolvable against live source by the re-verifier. */
  locator?: import("@/lib/deliberation/evidence").StructuredLocator;
  /** Evidence grade the citation was admitted at (A/B/C; D is inadmissible). */
  grade?: string;
  /** The scored option this citation backs. */
  optionId?: string;
  /** The scored dimension this citation backs. */
  dimensionKey?: string;
  /** The excerpt the score relied on, as recorded at decision time. */
  excerpt?: string | null;
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
