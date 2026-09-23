// apps/web/lib/deliberation/routing-confidence.ts
//
// BI-1A5204A0: how much confidence routing had in the endpoint it chose, as an
// input to whether deliberation runs.
//
// Routing decides quality once, in advance, by comparing predicted model scores
// against a floor. When nothing clears that floor the exclusion is SOFT
// (BI-16A1B4A3): routing relaxes it, runs anyway, and sets `qualityFloorRelaxed`.
// That flag was set at pipeline-v2.ts:334, threaded up, and concatenated into a
// rationale sentence — and nothing read it. The platform knew it was about to
// produce lower-confidence work and did nothing differently.
//
// Observed live on 2026-09-18: during a five-minute self-upgrade drain every
// routed phase fell to a local 27B with "8 endpoint(s) excluded; 1 candidate(s)
// ranked" and ran below the floor silently.
//
// This maps that knowledge onto the RISK axis the activation policy already
// consumes, rather than widening the closed DeliberationTriggerSource set. That
// is the honest shape as well as the smaller change: low routing confidence IS a
// risk statement about the output. Because it composes through the existing
// strengthen-but-not-weaken rule, it can only ever ADD scrutiny.
//
// Spec: docs/superpowers/specs/2026-09-18-quality-by-process-not-by-floor-design.md §1

import type { DeliberationActivatedRiskLevel } from "./types";

export interface RoutingConfidenceSignal {
  /** The floor was relaxed because no endpoint cleared it. */
  qualityFloorRelaxed?: boolean;
  /**
   * How far below the floor the winner sits, in the same 0-100 space the
   * dimension scores use. 0 (or absent) means "at the floor".
   */
  floorShortfall?: number;
  /** The winner was reached by fallback, not by ranking (outage, capacity, fence). */
  fallbackUsed?: boolean;
  /** How many candidates were ranked. One means there was no choice, only an outcome. */
  candidateCount?: number;
}

/** Ordering for the closed risk set, so "take the higher" is expressible. */
const RISK_ORDER: Record<DeliberationActivatedRiskLevel, number> = {
  low: 0,
  medium: 1,
  high: 2,
  critical: 3,
};

/** A shortfall at or above this is a large one — worth an adversarial pass. */
export const LARGE_SHORTFALL = 15;

/**
 * BI-2A67FAE2: escalation is real spend, so it is bounded.
 *
 * The confidence axis may raise the effective risk by at most ONE rung above
 * what the caller declared. Without this a single below-floor route could take
 * low-risk work straight to debate, and a degraded turn — exactly the turn where
 * the platform is least healthy — would become the most expensive one.
 *
 * An `economy` posture opts out of confidence escalation entirely: it is an
 * explicit choice to accept a weaker answer rather than pay for a second look.
 * Declared risk and stage defaults still apply, so economy is a discount on
 * inferred escalation, never a way to dodge a policy requirement.
 */
export function boundedConfidenceRisk(
  declared: DeliberationActivatedRiskLevel,
  inferred: DeliberationActivatedRiskLevel,
  costPosture?: string | null,
): DeliberationActivatedRiskLevel {
  if (costPosture === "economy") return declared;
  const ceiling = Math.min(RISK_ORDER[declared] + 1, RISK_ORDER.critical);
  const capped = Math.min(RISK_ORDER[inferred], ceiling);
  const target = Math.max(RISK_ORDER[declared], capped);
  return (Object.keys(RISK_ORDER) as DeliberationActivatedRiskLevel[]).find(
    (level) => RISK_ORDER[level] === target,
  ) as DeliberationActivatedRiskLevel;
}

export function higherRisk(
  a: DeliberationActivatedRiskLevel,
  b: DeliberationActivatedRiskLevel,
): DeliberationActivatedRiskLevel {
  return RISK_ORDER[a] >= RISK_ORDER[b] ? a : b;
}

/**
 * The risk level this routing outcome implies.
 *
 * Never returns above `high`: a weak answer is worth checking, but it is not the
 * same class of hazard as a critical-risk change, and it must not be able to
 * outrank one.
 */
export function routingConfidenceRisk(
  signal: RoutingConfidenceSignal | null | undefined,
): DeliberationActivatedRiskLevel {
  if (!signal) return "low";

  // Below the floor by a lot: the prediction says this will likely be weak, so
  // look at what actually came out, adversarially.
  if (signal.qualityFloorRelaxed && (signal.floorShortfall ?? 0) >= LARGE_SHORTFALL) {
    return "high";
  }

  // Below the floor at all.
  if (signal.qualityFloorRelaxed) return "medium";

  // Exactly one candidate: routing made no choice, it reported an outcome. The
  // floor may nominally have been met, but nothing competed for the work.
  if (typeof signal.candidateCount === "number" && signal.candidateCount <= 1) {
    return "medium";
  }

  // Reached by fallback rather than by ranking.
  if (signal.fallbackUsed) return "medium";

  return "low";
}

/**
 * Operator-readable reason this routing outcome raised the effort, or null when
 * it did not. Used in the activation reason so an escalation explains itself
 * rather than appearing as unexplained extra cost.
 */
export function describeRoutingConfidence(
  signal: RoutingConfidenceSignal | null | undefined,
): string | null {
  if (!signal) return null;

  if (signal.qualityFloorRelaxed) {
    return (signal.floorShortfall ?? 0) >= LARGE_SHORTFALL
      ? "no model met the quality bar for this work, and the one that ran is well short of it"
      : "no model met the quality bar for this work";
  }
  if (typeof signal.candidateCount === "number" && signal.candidateCount <= 1) {
    return "only one model was available, so nothing competed for this work";
  }
  if (signal.fallbackUsed) {
    return "the model that ran was a fallback rather than the ranked choice";
  }
  return null;
}
