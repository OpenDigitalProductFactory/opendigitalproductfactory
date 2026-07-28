// The two honesty rules of the journey watchdog, as pure functions.
// Spec: docs/superpowers/specs/2026-07-28-critical-business-journey-watchdog-design.md §3
//
// These exist so a watchdog cannot manufacture false confidence. They are the
// mechanism that keeps this module on the right side of the
// `structural-verification-is-not-functional` commandment.

import {
  DEPTH_ORDER,
  DEPTH_MEANING,
  SUPPORTED_DEPTHS,
  type JourneyStepResult,
  type VerificationDepth,
} from "./types";

function rank(depth: VerificationDepth): number {
  return DEPTH_ORDER.indexOf(depth);
}

/**
 * Rule 1 — a journey's achieved depth is the WEAKEST depth among its passing
 * steps, never the strongest. One `reachability`-only step caps the whole
 * journey at `reachability`, however many deeper steps also passed.
 *
 * Returns null when nothing passed: a failed or empty journey established
 * nothing, and reporting a depth for it would be a claim about a run that did
 * not happen.
 */
export function achievedDepth(steps: readonly JourneyStepResult[]): VerificationDepth | null {
  const passing = steps.filter((s) => s.outcome === "passed");
  if (passing.length === 0) return null;
  return passing.reduce<VerificationDepth>(
    (weakest, step) => (rank(step.depth) < rank(weakest) ? step.depth : weakest),
    passing[0].depth,
  );
}

/**
 * Rule 2 — everything above the achieved depth is explicitly UNCHECKED and must
 * be surfaced. When nothing passed, every depth is unchecked.
 *
 * `interaction` is always in this list for now: P1 does not drive the real
 * server action or a browser, and the product says so rather than implying
 * coverage it does not have.
 */
export function uncheckedDepths(achieved: VerificationDepth | null): VerificationDepth[] {
  if (achieved === null) return [...DEPTH_ORDER];
  return DEPTH_ORDER.filter((d) => rank(d) > rank(achieved));
}

/** True when a depth is one this slice can actually establish. */
export function isSupportedDepth(depth: VerificationDepth): boolean {
  return SUPPORTED_DEPTHS.includes(depth);
}

/**
 * The owner-facing "what we did not check" sentence. Deliberately plain: the
 * reader is a business owner, not an engineer.
 *
 * Returns null only when there is genuinely nothing left unchecked, which
 * cannot happen while `interaction` is uncovered — but the null branch keeps
 * the contract honest if a later slice closes the ladder.
 */
export function uncheckedSentence(achieved: VerificationDepth | null): string | null {
  const unchecked = uncheckedDepths(achieved);
  if (unchecked.length === 0) return null;
  const parts = unchecked.map((d) => DEPTH_MEANING[d]);
  return `Not checked: ${parts.join("; ")}.`;
}

/** The owner-facing "what we did check" sentence. Null when nothing passed. */
export function checkedSentence(achieved: VerificationDepth | null): string | null {
  if (achieved === null) return null;
  return `Checked: ${DEPTH_MEANING[achieved]}.`;
}
