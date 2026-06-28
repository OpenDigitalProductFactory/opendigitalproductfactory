import type { AutonomyLevel, RiskClass } from "@/lib/autonomy/trust-graduation";
import type {
  CoworkerCapabilityNeedStatus,
} from "@/lib/coworker-self-assessment/types";
import type { WorkPatternShadowEvaluation } from "./work-pattern-shadow-evaluation";
import type {
  WorkPatternCandidate,
  WorkPatternDecisionScope,
} from "./work-pattern-types";

export const WORK_PATTERN_REVIEW_ACTIONS = ["approve", "reject", "defer"] as const;
export type WorkPatternReviewAction = (typeof WORK_PATTERN_REVIEW_ACTIONS)[number];

export const WORK_PATTERN_REVIEW_STATUSES = [
  "approved-candidate",
  "rejected",
  "deferred",
] as const;
export type WorkPatternReviewStatus = (typeof WORK_PATTERN_REVIEW_STATUSES)[number];

export type WorkPatternActivationCandidate = {
  state: "candidate";
  activationAllowed: false;
  patternKey: string;
  agentId: string;
  routeContext: string | null;
  riskClass: RiskClass | null;
  decisionScope: WorkPatternDecisionScope;
  currentAutonomyLevel: AutonomyLevel;
  proposedAutonomyLevel: AutonomyLevel;
  evidenceSummary: {
    samples: number;
    agreements: number;
    agreementRate: number | null;
  };
  blockers: string[];
};

export type WorkPatternReviewState = {
  action: WorkPatternReviewAction;
  status: WorkPatternReviewStatus;
  needId: string;
  agentId: string;
  patternKey: string;
  routeContext: string | null;
  riskClass: RiskClass | null;
  decisionScope: WorkPatternDecisionScope;
  decisionInteractionId: string;
  reviewerUserId: string;
  reviewedAt: string;
  reviewerNote: string | null;
  blockers: string[];
  activationProposed: boolean;
  activationCandidate: WorkPatternActivationCandidate | null;
};

export type BuildWorkPatternReviewInput = {
  action: WorkPatternReviewAction;
  needId: string;
  agentId: string;
  patternKey: string;
  routeContext: string | null;
  riskClass: RiskClass | null;
  decisionScope: WorkPatternDecisionScope;
  candidate: WorkPatternCandidate | null;
  shadowEvaluation: WorkPatternShadowEvaluation | null;
  decisionInteractionId: string;
  reviewerUserId: string;
  reviewedAt: Date;
  reviewerNote?: string | null;
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function isAction(value: unknown): value is WorkPatternReviewAction {
  return typeof value === "string" && WORK_PATTERN_REVIEW_ACTIONS.includes(value as WorkPatternReviewAction);
}

function isStatus(value: unknown): value is WorkPatternReviewStatus {
  return typeof value === "string" && WORK_PATTERN_REVIEW_STATUSES.includes(value as WorkPatternReviewStatus);
}

function stringField(source: Record<string, unknown>, field: string): string | null {
  const value = source[field];
  return typeof value === "string" && value.trim().length > 0 ? value.trim() : null;
}

function booleanField(source: Record<string, unknown>, field: string): boolean | null {
  const value = source[field];
  return typeof value === "boolean" ? value : null;
}

function parseStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.filter((entry): entry is string => typeof entry === "string" && entry.trim().length > 0);
}

function parseRiskClass(value: unknown): RiskClass | null {
  return (
    value === "read-only" ||
    value === "internal-reversible" ||
    value === "internal-irreversible" ||
    value === "outbound-or-floor"
  )
    ? value
    : null;
}

function parseAutonomyLevel(value: unknown): AutonomyLevel | null {
  return value === "shadow" || value === "propose" || value === "supervised" || value === "autopilot"
    ? value
    : null;
}

function parseDecisionScope(value: unknown): WorkPatternDecisionScope | null {
  return value === "platform-wwmd" || value === "company-wwwd" || value === "profession-wsid"
    ? value
    : null;
}

function parseActivationCandidate(value: unknown): WorkPatternActivationCandidate | null {
  if (!isRecord(value)) return null;
  const patternKey = stringField(value, "patternKey");
  const agentId = stringField(value, "agentId");
  const decisionScope = parseDecisionScope(value.decisionScope);
  const currentAutonomyLevel = parseAutonomyLevel(value.currentAutonomyLevel);
  const proposedAutonomyLevel = parseAutonomyLevel(value.proposedAutonomyLevel);
  const evidenceSummary = isRecord(value.evidenceSummary) ? value.evidenceSummary : {};
  if (
    value.state !== "candidate" ||
    value.activationAllowed !== false ||
    !patternKey ||
    !agentId ||
    !decisionScope ||
    !currentAutonomyLevel ||
    !proposedAutonomyLevel
  ) {
    return null;
  }
  return {
    state: "candidate",
    activationAllowed: false,
    patternKey,
    agentId,
    routeContext: typeof value.routeContext === "string" ? value.routeContext : null,
    riskClass: parseRiskClass(value.riskClass),
    decisionScope,
    currentAutonomyLevel,
    proposedAutonomyLevel,
    evidenceSummary: {
      samples: typeof evidenceSummary.samples === "number" ? evidenceSummary.samples : 0,
      agreements: typeof evidenceSummary.agreements === "number" ? evidenceSummary.agreements : 0,
      agreementRate: typeof evidenceSummary.agreementRate === "number" ? evidenceSummary.agreementRate : null,
    },
    blockers: parseStringArray(value.blockers),
  };
}

function activationCandidateFrom(input: BuildWorkPatternReviewInput): WorkPatternActivationCandidate {
  const evaluation = input.shadowEvaluation;
  const recommendation = evaluation?.trustRecommendation;
  if (
    !evaluation ||
    evaluation.decision !== "approve-narrower-scope" ||
    recommendation?.action !== "promote"
  ) {
    throw new Error("approval_requires_promotable_shadow_evidence");
  }
  return {
    state: "candidate",
    activationAllowed: false,
    patternKey: input.patternKey,
    agentId: input.agentId,
    routeContext: input.routeContext,
    riskClass: input.riskClass,
    decisionScope: input.decisionScope,
    currentAutonomyLevel: evaluation.currentLevel,
    proposedAutonomyLevel: recommendation.to,
    evidenceSummary: {
      samples: evaluation.samples,
      agreements: evaluation.agreements,
      agreementRate: evaluation.agreementRate,
    },
    blockers: ["activation-candidate-awaits-governed-promotion"],
  };
}

export function workPatternReviewStatusForAction(
  action: WorkPatternReviewAction,
): WorkPatternReviewStatus {
  if (action === "approve") return "approved-candidate";
  if (action === "reject") return "rejected";
  return "deferred";
}

export function capabilityNeedStatusForReviewAction(
  action: WorkPatternReviewAction,
): CoworkerCapabilityNeedStatus {
  if (action === "approve") return "accepted";
  if (action === "reject") return "discarded";
  return "deferred";
}

export function buildWorkPatternReview(input: BuildWorkPatternReviewInput): WorkPatternReviewState {
  const activationCandidate =
    input.action === "approve" ? activationCandidateFrom(input) : null;
  const blockers = activationCandidate
    ? [...activationCandidate.blockers]
    : input.action === "reject"
      ? ["operator-rejected-pattern-candidate"]
      : ["operator-deferred-pattern-candidate"];

  return {
    action: input.action,
    status: workPatternReviewStatusForAction(input.action),
    needId: input.needId,
    agentId: input.agentId,
    patternKey: input.patternKey,
    routeContext: input.routeContext,
    riskClass: input.riskClass,
    decisionScope: input.decisionScope,
    decisionInteractionId: input.decisionInteractionId,
    reviewerUserId: input.reviewerUserId,
    reviewedAt: input.reviewedAt.toISOString(),
    reviewerNote: input.reviewerNote?.trim() || null,
    blockers,
    activationProposed: Boolean(activationCandidate),
    activationCandidate,
  };
}

export function mergeWorkPatternReviewState(
  readinessJson: unknown,
  review: WorkPatternReviewState,
): Record<string, unknown> {
  const base = isRecord(readinessJson) ? readinessJson : {};
  return {
    ...base,
    activationProposed: review.activationProposed,
    workPatternReview: review,
  };
}

export function parseWorkPatternReviewState(value: unknown): WorkPatternReviewState | null {
  const review = isRecord(value) && isRecord(value.workPatternReview)
    ? value.workPatternReview
    : value;
  if (!isRecord(review)) return null;

  const action = isAction(review.action) ? review.action : null;
  const status = isStatus(review.status) ? review.status : null;
  const needId = stringField(review, "needId");
  const agentId = stringField(review, "agentId");
  const patternKey = stringField(review, "patternKey");
  const decisionInteractionId = stringField(review, "decisionInteractionId");
  const reviewerUserId = stringField(review, "reviewerUserId");
  const reviewedAt = stringField(review, "reviewedAt");
  const decisionScope = parseDecisionScope(review.decisionScope);
  if (
    !action ||
    !status ||
    !needId ||
    !agentId ||
    !patternKey ||
    !decisionInteractionId ||
    !reviewerUserId ||
    !reviewedAt ||
    !decisionScope
  ) {
    return null;
  }

  const activationCandidate = parseActivationCandidate(review.activationCandidate);
  return {
    action,
    status,
    needId,
    agentId,
    patternKey,
    routeContext: typeof review.routeContext === "string" ? review.routeContext : null,
    riskClass: parseRiskClass(review.riskClass),
    decisionScope,
    decisionInteractionId,
    reviewerUserId,
    reviewedAt,
    reviewerNote: typeof review.reviewerNote === "string" ? review.reviewerNote : null,
    blockers: parseStringArray(review.blockers),
    activationProposed: booleanField(review, "activationProposed") ?? Boolean(activationCandidate),
    activationCandidate,
  };
}
