// apps/web/lib/deliberation/reviewer-independence.ts
//
// BI-0FC71985: say how independent a review actually was, rather than assuming it.
//
// A reviewer sampled from the same degraded model as the author is weak scrutiny,
// and nothing distinguished that from genuine independent review. The diversity
// vocabulary already grades it — single-model-multi-persona |
// multi-model-same-provider | multi-provider-heterogeneous — but the mode was read
// off the pattern's own hints, so a pattern could ask for heterogeneous review on
// an install with exactly one model and the receipt would say it got it.
//
// The rule: take the strongest mode the pool can actually support, capped by what
// the pattern asked for, and RECORD which one was used. A
// single-model-multi-persona review during an outage is not equivalent to
// heterogeneous review, and the receipt must not let those read the same.
//
// This matters most in exactly the case that motivated the epic: during a drain
// the author and the reviewer are the same local model. That review is still
// worth running — it catches carelessness and instability — but it does not catch
// systematic bias, and claiming otherwise would be the more expensive mistake.
//
// Spec: docs/superpowers/specs/2026-09-18-quality-by-process-not-by-floor-design.md §3

import type { DeliberationDiversityMode } from "./types";

/** What the install can actually field for this call. */
export interface ReviewerPool {
  /** Distinct eligible providers. */
  providerCount?: number;
  /** Distinct eligible models, across all providers. */
  modelCount?: number;
}

const MODE_STRENGTH: Record<DeliberationDiversityMode, number> = {
  "single-model-multi-persona": 0,
  "multi-model-same-provider": 1,
  "multi-provider-heterogeneous": 2,
};

const BY_STRENGTH: DeliberationDiversityMode[] = [
  "single-model-multi-persona",
  "multi-model-same-provider",
  "multi-provider-heterogeneous",
];

/** True when the caller told us anything measurable about the pool. */
export function poolIsKnown(pool: ReviewerPool | null | undefined): boolean {
  return !!pool && (typeof pool.providerCount === "number" || typeof pool.modelCount === "number");
}

/**
 * The strongest independence this pool can actually deliver.
 *
 * Only meaningful for a KNOWN pool. An unknown pool is not evidence of a single
 * model — it is absence of evidence, and the two must not be conflated: treating
 * "we were not told" as "there is only one model" would silently downgrade every
 * caller that has not yet been taught to report its pool.
 */
export function achievableDiversity(pool: ReviewerPool | null | undefined): DeliberationDiversityMode {
  if ((pool?.providerCount ?? 0) >= 2) return "multi-provider-heterogeneous";
  if ((pool?.modelCount ?? 0) >= 2) return "multi-model-same-provider";
  return "single-model-multi-persona";
}

export interface IndependenceGrade {
  /** The mode actually used — never stronger than a KNOWN pool supports. */
  mode: DeliberationDiversityMode;
  /** True when the pattern wanted more independence than the pool could give. */
  downgraded: boolean;
  /**
   * False when the caller reported no pool. The mode is then the pattern's
   * intent rather than a measured fact, and must not be read as evidence that
   * the review was independent.
   */
  verified: boolean;
  /** What the pattern asked for, when that differs from what it got. */
  requested?: DeliberationDiversityMode;
  /** Operator-readable statement of what this review is worth. */
  note: string;
}

const NOTES: Record<DeliberationDiversityMode, string> = {
  "multi-provider-heterogeneous":
    "Reviewed by a different provider — different training and different failure modes.",
  "multi-model-same-provider":
    "Reviewed by a different model from the same provider — partly independent; some failure modes are shared.",
  "single-model-multi-persona":
    "Reviewed by the same model in a different role — catches carelessness and instability, not systematic bias.",
};

/**
 * Grade the independence of a review: the strongest mode available, capped by
 * what the pattern asked for, with a note saying what it is actually worth.
 */
export function gradeIndependence(
  requested: DeliberationDiversityMode,
  pool: ReviewerPool | null | undefined,
): IndependenceGrade {
  // Unknown pool: honour the pattern's intent, but say the grade is unverified
  // rather than either overclaiming it or silently downgrading it.
  if (!poolIsKnown(pool)) {
    return {
      mode: requested,
      downgraded: false,
      verified: false,
      note: `${NOTES[requested]} Not verified against the models actually available for this call.`,
    };
  }

  const achievable = achievableDiversity(pool);
  const mode =
    MODE_STRENGTH[requested] <= MODE_STRENGTH[achievable] ? requested : achievable;
  const downgraded = MODE_STRENGTH[mode] < MODE_STRENGTH[requested];

  return {
    mode,
    downgraded,
    verified: true,
    ...(downgraded ? { requested } : {}),
    note: downgraded
      ? `${NOTES[mode]} The pattern asked for stronger independence than this install can field.`
      : NOTES[mode],
  };
}

/** Strongest-first ordering, for callers that want to try modes in turn. */
export function modesByStrength(): DeliberationDiversityMode[] {
  return [...BY_STRENGTH].reverse();
}
