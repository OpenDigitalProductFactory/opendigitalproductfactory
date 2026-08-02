import {
  CHANGE_REVIEW_POLICY_VERSION,
  assessSemanticReviewReceiptFreshness,
  type SemanticReviewDecision,
  type SemanticReviewDisposition,
  type SemanticReviewIdentity,
  type SemanticReviewReceipt,
} from "./semantic-change-review";
import type { SemanticChangeReviewMode, SemanticChangeReviewSurface } from "./semantic-change-review-operation";

export const SEMANTIC_REVIEW_EXEMPTION_SCHEMA_VERSION = "semantic-change-review-exemption.v1";
export const SEMANTIC_REVIEW_OUTCOME_SCHEMA_VERSION = "semantic-change-review-outcome.v1";

export interface SemanticReviewPolicyExemption {
  schemaVersion: typeof SEMANTIC_REVIEW_EXEMPTION_SCHEMA_VERSION;
  policyVersion: string;
  capsuleId: string;
  diffDigest: string;
  evidenceId: string;
  reason: string;
  expiresAt: string;
}

export interface SemanticReviewPublicationControl {
  disposition: "allow" | "block" | "shadow-observe";
  reason:
    | "fresh-receipt"
    | "missing-receipt"
    | "stale-receipt"
    | "semantic-failure"
    | "infrastructure-inconclusive"
    | "policy-exemption"
    | "invalid-exemption";
  mayPublish: boolean;
  staleReasons: string[];
}

function exemptionIsValid(
  exemption: SemanticReviewPolicyExemption,
  identity: SemanticReviewIdentity,
  now: Date,
): boolean {
  return exemption.schemaVersion === SEMANTIC_REVIEW_EXEMPTION_SCHEMA_VERSION &&
    exemption.policyVersion === CHANGE_REVIEW_POLICY_VERSION &&
    exemption.policyVersion === identity.policyVersion &&
    exemption.capsuleId === identity.capsuleId &&
    exemption.diffDigest === identity.diffDigest &&
    exemption.evidenceId.trim().length > 0 &&
    exemption.reason.trim().length > 0 &&
    Number.isFinite(Date.parse(exemption.expiresAt)) &&
    Date.parse(exemption.expiresAt) > now.getTime();
}

/** Pure, no-I/O publication control. Safe for hooks and pregate preflight. */
export function evaluateSemanticReviewPublicationControl(input: {
  mode: SemanticChangeReviewMode;
  identity: SemanticReviewIdentity;
  receipt: SemanticReviewReceipt | null;
  exemption?: SemanticReviewPolicyExemption | null;
  now?: Date;
}): SemanticReviewPublicationControl {
  const now = input.now ?? new Date();
  if (!input.receipt) {
    if (input.exemption) {
      const valid = exemptionIsValid(input.exemption, input.identity, now);
      if (valid) return { disposition: "allow", reason: "policy-exemption", mayPublish: true, staleReasons: [] };
      if (input.mode === "shadow") {
        return { disposition: "shadow-observe", reason: "invalid-exemption", mayPublish: true, staleReasons: [] };
      }
      return { disposition: "block", reason: "invalid-exemption", mayPublish: false, staleReasons: [] };
    }
    return input.mode === "shadow"
      ? { disposition: "shadow-observe", reason: "missing-receipt", mayPublish: true, staleReasons: [] }
      : { disposition: "block", reason: "missing-receipt", mayPublish: false, staleReasons: [] };
  }

  const freshness = assessSemanticReviewReceiptFreshness(input.receipt, input.identity);
  if (!freshness.fresh) {
    return input.mode === "shadow"
      ? { disposition: "shadow-observe", reason: "stale-receipt", mayPublish: true, staleReasons: freshness.reasons }
      : { disposition: "block", reason: "stale-receipt", mayPublish: false, staleReasons: freshness.reasons };
  }
  if (input.receipt.result.decision === "inconclusive") {
    return input.mode === "shadow"
      ? { disposition: "shadow-observe", reason: "infrastructure-inconclusive", mayPublish: true, staleReasons: [] }
      : { disposition: "block", reason: "infrastructure-inconclusive", mayPublish: false, staleReasons: [] };
  }
  if (input.receipt.result.decision === "fail") {
    return input.mode === "shadow"
      ? { disposition: "shadow-observe", reason: "semantic-failure", mayPublish: true, staleReasons: [] }
      : { disposition: "block", reason: "semantic-failure", mayPublish: false, staleReasons: [] };
  }
  return { disposition: "allow", reason: "fresh-receipt", mayPublish: true, staleReasons: [] };
}

export interface SemanticReviewOutcome {
  schemaVersion: typeof SEMANTIC_REVIEW_OUTCOME_SCHEMA_VERSION;
  receiptId: string;
  capsuleId: string;
  surface: SemanticChangeReviewSurface;
  reviewDisposition: SemanticReviewDisposition;
  reviewDecision: SemanticReviewDecision;
  correlationStatus: "completed" | "infrastructure-inconclusive";
  acceptedFindingCount: number;
  falsePositiveFindingCount: number;
  uniqueLocalFindingCount: number;
  postPublicationMissCount: number;
  correctivePushCount: number;
  timeToFirstSignalMs: number | null;
  costUsd: number | null;
  github: { pullRequestNumber: number; ciPassed: boolean; merged: boolean };
  recordedAt: string;
}

function ratio(numerator: number, denominator: number): number | null {
  return denominator > 0 ? numerator / denominator : null;
}

export function aggregateSemanticReviewOutcomes(outcomes: readonly SemanticReviewOutcome[]) {
  const completed = outcomes.filter((outcome) => outcome.correlationStatus === "completed");
  const accepted = completed.reduce((sum, outcome) => sum + outcome.acceptedFindingCount, 0);
  const falsePositives = completed.reduce((sum, outcome) => sum + outcome.falsePositiveFindingCount, 0);
  const unique = completed.reduce((sum, outcome) => sum + outcome.uniqueLocalFindingCount, 0);
  const misses = completed.reduce((sum, outcome) => sum + outcome.postPublicationMissCount, 0);
  return {
    totalSamples: outcomes.length,
    completedSamples: completed.length,
    infrastructureInconclusiveSamples: outcomes.length - completed.length,
    externalCompletedSamples: completed.filter((outcome) => outcome.surface === "external").length,
    buildStudioCompletedSamples: completed.filter((outcome) => outcome.surface === "build-studio").length,
    acceptedFindingCount: accepted,
    falsePositiveFindingCount: falsePositives,
    postPublicationMissCount: misses,
    correctivePushCount: completed.reduce((sum, outcome) => sum + outcome.correctivePushCount, 0),
    precision: ratio(accepted, accepted + falsePositives),
    uniqueYieldPerCompletedSample: ratio(unique, completed.length),
    postPublicationMissRate: ratio(misses, completed.length),
    averageTimeToFirstSignalMs: ratio(
      completed.reduce((sum, outcome) => sum + (outcome.timeToFirstSignalMs ?? 0), 0),
      completed.filter((outcome) => outcome.timeToFirstSignalMs !== null).length,
    ),
    totalCostUsd: completed.reduce((sum, outcome) => sum + (outcome.costUsd ?? 0), 0),
  };
}

export function projectSemanticReviewOutcome(outcome: SemanticReviewOutcome) {
  const summary = outcome.correlationStatus === "completed"
    ? `Semantic review outcome correlated with PR #${outcome.github.pullRequestNumber}.`
    : `Semantic review outcome excluded from calibration: infrastructure-inconclusive.`;
  return {
    externalEvidence: {
      routeContext: "change-review" as const,
      operationType: "semantic-change-review.outcome" as const,
      target: outcome.receiptId,
      provider: "dpf-change-review" as const,
      resultSummary: summary,
      details: outcome,
    },
    activity: { kind: "evidence-recorded" as const, summary, payload: outcome },
  };
}
