// Graduated gate autonomy — risk-tier derivation + ladder outcome for Build
// Studio phase gates.
//
// BI-D996C238 (EP-0AF96937). Today the only WWMD-governed Build Studio gate is
// plan->build, and it hardcodes riskTier="medium" for every build regardless of
// what the change touches. That is neither graduated nor extensible: a cosmetic
// copy change and a change to the decision kernel get the SAME confidence bar,
// and no other transition (ideate-start, review->ship) is governed at all.
//
// The 2026 consensus is GRADUATED autonomy, not binary: auto-proceed for
// low-risk well-evidenced transitions, human review for high-risk ones, keyed to
// what the change touches. This module is the pure, testable core of that:
//   - deriveTransitionRiskTier: (deliverable sensitivity x transition) -> risk
//     tier, so a low-sensitivity ship can clear on the ladder while a
//     high-sensitivity one always escalates, and the more consequential the
//     transition (ship > plan-advance > ideate-start) the higher the bar.
//   - graduatedGateOutcome: the single place that reads an evaluator outcome +
//     risk tier into an auto-proceed / requires-human decision (centralizing the
//     `allowed = recommend|arbitrate` logic the gate currently inlines).
//
// No DB, no inference — pure and unit-testable. The DB-backed gate wires these;
// the escalate-on-high/critical guarantee still lives in the evaluator ladder.

import type { DecisionRiskTier, DecisionOutcomeType } from "./types";
import type { DeliverableSensitivity } from "@/lib/explore/build-process-matrix";

/** The governed Build Studio phase transitions, least→most consequential. */
export type GovernedTransition = "ideate-start" | "plan-advance" | "ship";

const TIER_RANK: Record<DecisionRiskTier, number> = { low: 0, medium: 1, high: 2, critical: 3 };
const RANK_TIER: DecisionRiskTier[] = ["low", "medium", "high", "critical"];

/** Base risk from what the deliverable touches. */
const SENSITIVITY_BASE: Record<DeliverableSensitivity, DecisionRiskTier> = {
  low: "low",
  elevated: "medium",
  high: "high",
};

/** How much each transition raises the bar above the sensitivity base. ship is
 *  the most consequential (code enters the repo / prod), ideate-start the least
 *  (only starts design work), plan-advance in between (matches today's gate). */
const TRANSITION_BUMP: Record<GovernedTransition, number> = {
  "ideate-start": -1,
  "plan-advance": 0,
  ship: 1,
};

function clampTier(rank: number): DecisionRiskTier {
  const r = Math.max(0, Math.min(RANK_TIER.length - 1, rank));
  return RANK_TIER[r];
}

/**
 * PURE. Derive the decision risk tier for a governed transition from the
 * deliverable's sensitivity and how consequential the transition is. A
 * high-sensitivity change never drops below "high" (so the evaluator's
 * escalate-on-high/critical guarantee always fires for it), and ship never
 * drops below "medium" (shipping code is never a low-risk act).
 */
export function deriveTransitionRiskTier(input: {
  sensitivity: DeliverableSensitivity;
  transition: GovernedTransition;
}): DecisionRiskTier {
  const base = SENSITIVITY_BASE[input.sensitivity] ?? "medium";
  let tier = clampTier(TIER_RANK[base] + TRANSITION_BUMP[input.transition]);
  // Floors: high sensitivity stays >= high; shipping stays >= medium.
  if (input.sensitivity === "high" && TIER_RANK[tier] < TIER_RANK.high) tier = "high";
  if (input.transition === "ship" && TIER_RANK[tier] < TIER_RANK.medium) tier = "medium";
  return tier;
}

export type GraduatedGateOutcome = {
  /** The transition may proceed without a human. */
  autoProceed: boolean;
  /** A human must decide (escalate/defer, or a non-proceed outcome). */
  requiresHuman: boolean;
  /** Machine reason for the decision. */
  reason: DecisionOutcomeType;
};

/**
 * PURE. Read an evaluator outcome into an auto-proceed / requires-human
 * decision. This is the single definition of "allowed" for a governed Build
 * Studio transition: only a `recommend` or `arbitrate` outcome auto-proceeds;
 * `escalate`, `defer` and `decline` never do. BI-2107B5D2: a `decline` is a
 * decisive no, so it does not auto-proceed — but it reaches a human as a
 * settled answer to act on, not as an unresolved question to re-litigate.
 * The risk-graduation itself is
 * already encoded upstream — the evaluator forces `escalate` at high/critical
 * risk — so this stays a thin, total mapping over the outcome.
 */
export function graduatedGateOutcome(outcomeType: DecisionOutcomeType): GraduatedGateOutcome {
  const autoProceed = outcomeType === "recommend" || outcomeType === "arbitrate";
  return {
    autoProceed,
    requiresHuman: !autoProceed,
    reason: outcomeType,
  };
}

/** True when this transition, at this risk tier, is even a candidate for
 *  autonomy (i.e. below the always-escalate high/critical floor). Callers use
 *  this to decide whether to bother running the gate for auto-proceed vs. going
 *  straight to a human — the evaluator would escalate high/critical anyway. */
export function isAutonomyCandidate(riskTier: DecisionRiskTier): boolean {
  return TIER_RANK[riskTier] <= TIER_RANK.medium;
}
