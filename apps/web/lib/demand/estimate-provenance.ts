// Pure estimate-provenance engine — no server imports. Safe in tests and client
// components. EP-DELIVERY-FLOW BI-E731A6C1 (write-model).
//
// The effort estimate (jobSize) is the value/effort score's DENOMINATOR — today
// invisible and single-source. Collaborative estimation makes it a visible,
// attributed, collaborative act: an AI coworker proposes a first-pass estimate
// the moment an item lands, a human can confirm or overrule it, and when the two
// disagree the divergence surfaces so a person can reconcile. This module is the
// pure resolver that turns the persisted provenance facets (the AI's number, the
// human's number, an agreement flag) into the derived truth the surface needs:
// which number is EFFECTIVE (feeds demandScore), WHOSE it is, and whether AI and
// human still diverge and need reconciling.
//
// Persisted facets live on BacklogItem (schema.prisma): estimateAiJobSize /
// estimateHumanJobSize / estimateAgreed etc. jobSize stays the effective
// denominator scoring reads; the write door mirrors `effectiveJobSize` into it.
//
// Spec: docs/superpowers/specs/2026-07-12-delivery-flow-demand-backlog-unification-design.md
// §"Collaborative estimation (the ÷ effort)".

import { EFFORT_SIZE_TO_JOB_SIZE } from "./scoring";

/**
 * Provenance of the EFFECTIVE effort estimate feeding demandScore.
 * - `ai`     — only an AI coworker has estimated (its first-pass proposal stands).
 * - `human`  — a human set or overruled the estimate (humans lead and decide).
 * - `agreed` — human and AI are reconciled (a human confirmed, or both landed on
 *              the same number); the score behind the item is trustworthy.
 */
export const ESTIMATE_SOURCE_VALUES = ["ai", "human", "agreed"] as const;
export type EstimateSource = (typeof ESTIMATE_SOURCE_VALUES)[number];

/** The persisted provenance facets the resolver reads (all nullable). */
export type EstimateProvenanceInputs = {
  /** The AI coworker's proposed effort points. */
  aiJobSize?: number | null;
  /** The human's proposed (or confirmed) effort points. */
  humanJobSize?: number | null;
  /** Explicit agreement flag: a human confirmed the estimate. */
  agreed?: boolean | null;
};

export type EstimateProvenance = {
  /**
   * The effective effort denominator that feeds demandScore, or null when
   * neither side has estimated (callers fall back to jobSize/effortSize).
   */
  effectiveJobSize: number | null;
  /** Whose judgment the effective estimate carries; null when unestimated. */
  source: EstimateSource | null;
  /**
   * Both sides estimated, the numbers differ, and they are not yet reconciled —
   * the card shows `⇄ ai ↔ human · reconcile` and the score is provisional.
   */
  diverged: boolean;
  /** Human and AI are reconciled (explicit confirm, or identical numbers). */
  agreed: boolean;
};

function num(v: number | null | undefined): number | null {
  return typeof v === "number" && Number.isFinite(v) ? v : null;
}

/**
 * The AI coworker's first-pass effort estimate — derived from the t-shirt
 * `effortSize` signal already captured at intake — so a coworker can propose an
 * estimate forward the moment an item lands, before any human has weighed in.
 * Returns null when the item has no effortSize to project from (nothing to
 * propose; a human sets the first number). EP-DELIVERY-FLOW BI-AA1763CD.
 */
export function firstPassJobSize(effortSize: string | null | undefined): number | null {
  if (effortSize && effortSize in EFFORT_SIZE_TO_JOB_SIZE) return EFFORT_SIZE_TO_JOB_SIZE[effortSize];
  return null;
}

/**
 * Resolve the derived estimate provenance from the persisted facets. Pure and
 * idempotent.
 *
 * Rules (operator stance: AI proposes forward, humans lead and decide):
 * - A human number OVERRULES an AI number — when both exist the human's is
 *   effective. When only one side estimated, that side's number is effective.
 * - `agreed` is true when a human explicitly confirmed OR both numbers are
 *   identical. Agreement clears divergence (the score is trustworthy).
 * - `diverged` is true only when BOTH sides estimated, the numbers differ, and
 *   they are not agreed — that is the state that needs a human to reconcile.
 */
export function resolveEstimateProvenance(inputs: EstimateProvenanceInputs): EstimateProvenance {
  const ai = num(inputs.aiJobSize);
  const human = num(inputs.humanJobSize);
  const bothPresent = ai !== null && human !== null;
  const identical = bothPresent && ai === human;
  const agreed = inputs.agreed === true || identical;

  // Neither side wins by provenance (BI-A5697C5E). When both exist and disagree,
  // `diverged` below marks the estimate provisional and reconciliation is required
  // before it can be used — so this pick is never the silent tiebreaker it reads
  // like. When only one side estimated, that estimate stands on its own grounding,
  // whichever side produced it.
  const effectiveJobSize = human !== null ? human : ai;

  let source: EstimateSource | null;
  if (effectiveJobSize === null) source = null;
  else if (agreed) source = "agreed";
  else if (human !== null) source = "human";
  else source = "ai";

  const diverged = bothPresent && ai !== human && !agreed;

  return { effectiveJobSize, source, diverged, agreed };
}
