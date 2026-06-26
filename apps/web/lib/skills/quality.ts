// Skill quality-health signal for the governed Hermes curator (BI-93FE150F,
// EP-FULL-OBS).
//
// Companion to lifecycle.ts. classifySkillLifecycle answers "is this skill
// being USED?" on crisp presence-of-use signals (invoked === 0 / hasContent /
// assignmentCount === 0). It is deliberately blind to whether the invocations
// it counts SUCCEED: the curator collects usage30d.failed and then never reads
// it. This module fills exactly that gap — a deterministic read of the failure
// rate already in hand, with a small-sample guard so low-volume noise is never
// mislabelled as a regression.
//
// Why deterministic, not the learned classifier the BI literally asks for: the
// lifecycle boundary is crisp, so per the platform bridge-pattern doctrine (AI
// ascends only where the boundary is genuinely fuzzy, then re-descends to code
// once thresholds stabilise) there is nothing to "learn" yet — explicit
// thresholds are the correct floor. Ascent to a learned step is warranted only
// if these thresholds prove fuzzy in practice. See the design pass:
// docs/superpowers/plans/2026-06-26-curator-quality-health-ascent-design.md

export type SkillQualityVerdict =
  | "healthy" // failure rate within tolerance
  | "elevated-failures" // failing noticeably more than tolerance — worth a look
  | "regressing" // failing at or above half of invocations — acute
  | "insufficient-data"; // too few invocations to judge quality (the noise guard)

export interface SkillQualityInput {
  /** Total invocations in the window (SkillUsageEvent phase="invoked"). */
  invoked: number;
  /** Failed invocations in the window (phase="failed") — a subset of `invoked`. */
  failed: number;
}

export interface SkillQualityAssessment {
  verdict: SkillQualityVerdict;
  /** failed / invoked, clamped to [0,1]; null when there were no invocations. */
  failureRate: number | null;
  /** One-line, plain-language explanation — no internals. */
  reason: string;
}

/**
 * Minimum invocations before a failure rate is trustworthy. Below this a single
 * failure swings the rate wildly (1 of 2 = 50%), so we withhold a verdict
 * rather than cry "regression" on noise. This is the first threshold a future
 * learned step would tune — and the first to re-descend to code once stable.
 */
export const MIN_INVOCATIONS_FOR_QUALITY = 5;

/** failureRate at or above this → regressing (acute; ~majority failing). */
export const REGRESSING_FAILURE_RATE = 0.5;
/** failureRate at or above this (and below regressing) → elevated-failures. */
export const ELEVATED_FAILURE_RATE = 0.2;

/**
 * Deterministic quality-health read for a skill, derived from failure telemetry
 * the curator already holds. Pure — no DB, no clock — so it runs inside the
 * curator's per-skill loop and is fully unit-testable.
 *
 * Precedence (most-specific first):
 *   1. invoked === 0          → insufficient-data (nothing happened)
 *   2. invoked < MIN          → insufficient-data (sample too small to trust)
 *   3. rate >= REGRESSING     → regressing
 *   4. rate >= ELEVATED       → elevated-failures
 *   5. otherwise              → healthy
 */
export function assessSkillQuality(input: SkillQualityInput): SkillQualityAssessment {
  const invoked = Math.max(0, Math.trunc(input.invoked));
  const failed = Math.max(0, Math.trunc(input.failed));

  if (invoked === 0) {
    return { verdict: "insufficient-data", failureRate: null, reason: "no invocations to judge quality" };
  }

  // `failed` is a subset of `invoked`, but a terminal telemetry event can be
  // dropped, so clamp defensively rather than ever emit a rate above 1.
  const failureRate = Math.min(1, failed / invoked);

  if (invoked < MIN_INVOCATIONS_FOR_QUALITY) {
    return {
      verdict: "insufficient-data",
      failureRate,
      reason: `only ${invoked} invocation${invoked === 1 ? "" : "s"} — too few to judge quality`,
    };
  }

  if (failureRate >= REGRESSING_FAILURE_RATE) {
    return { verdict: "regressing", failureRate, reason: `${pct(failureRate)} of invocations failed in the window` };
  }

  if (failureRate >= ELEVATED_FAILURE_RATE) {
    return {
      verdict: "elevated-failures",
      failureRate,
      reason: `${pct(failureRate)} of invocations failed — above the ${pct(ELEVATED_FAILURE_RATE)} tolerance`,
    };
  }

  return {
    verdict: "healthy",
    failureRate,
    reason: failed === 0 ? "no failures in the window" : `${pct(failureRate)} failure rate — within tolerance`,
  };
}

function pct(rate: number): string {
  return `${Math.round(rate * 100)}%`;
}
