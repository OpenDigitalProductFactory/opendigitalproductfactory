/**
 * EP-WORK-POSTURE Slice B (BI-0C5A83A8) — the tighten-only mechanism.
 *
 * Design: docs/superpowers/specs/2026-08-22-workroom-work-posture-design.md §3.2.
 *
 *   A derivation may TIGHTEN. It may NEVER WIDEN.
 *
 * This is the property that makes it safe to put a derived posture on the hot
 * path, and it is deliberately implemented as a MECHANISM rather than a
 * convention: derived deltas are applied only through the clamps below, each of
 * which can move a value in one direction. A widening derivation is therefore
 * unrepresentable, not merely untested — there is no code path that expresses
 * one.
 *
 * The direction of "tighter" per axis:
 *   proactivity level   quiet < balanced < assertive   — tighter = MORE persistent
 *   action boundary     preauthorized < propose < advise — tighter = LESS authority
 *   quality tier        basic < adequate < strong < frontier — tighter = HIGHER floor
 *   verification depth  none < shallow < deep          — tighter = MORE checking
 *
 * Note the asymmetry that makes this safe: raising proactivity increases how
 * hard a coworker pushes for attention, while tightening the action boundary
 * decreases what it may do unattended. Neither direction ever hands a coworker
 * authority it did not already have.
 */
import type { QualityTier } from "@/lib/routing/quality-tiers";
import type {
  ProactivityActionBoundary,
  ProactivityLevel,
} from "@/lib/proactivity/proactivity-types";
import type { VerificationDepth } from "@/lib/golden-triangle";

const PROACTIVITY_RANK: Record<ProactivityLevel, number> = {
  quiet: 0,
  balanced: 1,
  assertive: 2,
};

/** Ascending in RESTRICTIVENESS: preauthorized is the most permissive. */
const BOUNDARY_RANK: Record<ProactivityActionBoundary, number> = {
  preauthorized: 0,
  propose: 1,
  advise: 2,
};

const TIER_RANK: Record<QualityTier, number> = {
  basic: 0,
  adequate: 1,
  strong: 2,
  frontier: 3,
};

const VERIFICATION_RANK: Record<VerificationDepth, number> = {
  none: 0,
  shallow: 1,
  deep: 2,
};

function pickHigher<T extends string>(
  current: T,
  candidate: T | null | undefined,
  rank: Record<T, number>,
): T {
  if (candidate == null) return current;
  return rank[candidate] > rank[current] ? candidate : current;
}

/** Raise persistence only. A derivation can never make a coworker quieter. */
export function tightenProactivityLevel(
  current: ProactivityLevel,
  candidate: ProactivityLevel | null | undefined,
): ProactivityLevel {
  return pickHigher(current, candidate, PROACTIVITY_RANK);
}

/** Restrict authority only. A derivation can never widen the action boundary. */
export function tightenActionBoundary(
  current: ProactivityActionBoundary,
  candidate: ProactivityActionBoundary | null | undefined,
): ProactivityActionBoundary {
  return pickHigher(current, candidate, BOUNDARY_RANK);
}

/** Raise the quality floor only. A derivation can never lower a tier floor. */
export function tightenMinimumTier(
  current: QualityTier | undefined,
  candidate: QualityTier | null | undefined,
): QualityTier | undefined {
  if (candidate == null) return current;
  if (current === undefined) return candidate;
  return pickHigher(current, candidate, TIER_RANK);
}

/** Deepen verification only. A derivation can never drop a verification requirement. */
export function tightenVerificationDepth(
  current: VerificationDepth | undefined,
  candidate: VerificationDepth | null | undefined,
): VerificationDepth | undefined {
  if (candidate == null) return current;
  if (current === undefined) return candidate;
  return pickHigher(current, candidate, VERIFICATION_RANK);
}

/**
 * Damping is the ONE derived effect that reduces something, so it is expressed
 * separately and constrained by construction: it lowers the proactivity LEVEL
 * (cadence and channel) by at most one step and touches nothing else. It cannot
 * reach the action boundary, the tier floor or the verification depth, so
 * out-of-hours damping can never hand a coworker authority (design §3.2, §6).
 */
export function dampProactivityLevel(current: ProactivityLevel): ProactivityLevel {
  return current === "assertive" ? "balanced" : current === "balanced" ? "quiet" : "quiet";
}

export const TIGHTEN_RANKS = {
  proactivity: PROACTIVITY_RANK,
  boundary: BOUNDARY_RANK,
  tier: TIER_RANK,
  verification: VERIFICATION_RANK,
} as const;
