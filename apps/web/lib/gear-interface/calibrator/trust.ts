// apps/web/lib/gear-interface/calibrator/trust.ts
//
// Reduction Gear Phase 1 — frequentist trust scoring.
//
// Pure function over a row slice: given the last N rows for a CalibrationKey
// (already filtered + sorted by the caller), compute mean torqueTechnical,
// sample size, confidence, and the recent-failure signal. Bayesian scaffolding
// returns the frequentist value until the prior+update math lands (Phase 1b).
//
// HITL weighting honors spec §6.3 — human-graded rows count more heavily so
// the platform's learning signal converges faster on labeled examples.
//
// Spec: docs/superpowers/specs/2026-05-24-reduction-gear-architecture-design.md §6.1

import { DEFAULT_OPTIONS, type CalibratorOptions, type TrustReading } from "./types";

/**
 * Row shape the scorer consumes. A minimal projection of GearInterface so the
 * scorer can be unit-tested without a live DB.
 */
export interface ScorableRow {
  torqueTechnical: number;
  graderType: string;
  recordedAt: Date;
}

/**
 * Compute the trust reading from an already-filtered, recordedAt-DESC row
 * slice. The caller is responsible for fetching the right slice — this stays
 * pure so the read path can swap query backends later (e.g. materialized
 * aggregates in Phase 2).
 */
export function computeFrequentistTrust(
  rows: ScorableRow[],
  options: CalibratorOptions = {},
): TrustReading {
  const opts = { ...DEFAULT_OPTIONS, ...options };
  const slice = rows.slice(0, opts.rollingWindow);

  if (slice.length === 0) {
    return {
      score: null,
      sampleSize: 0,
      confidence: 0,
      lastSeenAt: null,
      recentFailureCount: 0,
      humanGradedCount: 0,
    };
  }

  let weightedSum = 0;
  let weightTotal = 0;
  let recentFailures = 0;
  let humanGraded = 0;
  let lastSeen: Date | null = null;

  for (const row of slice) {
    const weight = row.graderType === "human" ? opts.humanGradeWeight : 1.0;
    weightedSum += row.torqueTechnical * weight;
    weightTotal += weight;
    if (row.torqueTechnical < 0.5) recentFailures += 1;
    if (row.graderType === "human") humanGraded += 1;
    if (!lastSeen || row.recordedAt > lastSeen) lastSeen = row.recordedAt;
  }

  const score = weightTotal > 0 ? weightedSum / weightTotal : null;
  const confidence = Math.min(1, slice.length / opts.confidenceAdequateSampleSize);

  return {
    score,
    sampleSize: slice.length,
    confidence,
    lastSeenAt: lastSeen,
    recentFailureCount: recentFailures,
    humanGradedCount: humanGraded,
  };
}

/**
 * Bayesian trust scaffolding. Phase 1 returns the frequentist score as a
 * pass-through so callers can switch on `useBayesian` without behavior change
 * yet. Phase 1b lands the actual prior+update math (Beta distribution over
 * the binary pass/fail latent, with the prior derived from the
 * confidence-adequate-sample-size knob).
 */
export function computeBayesianTrust(
  rows: ScorableRow[],
  options: CalibratorOptions = {},
): TrustReading {
  // SCAFFOLD: identical to frequentist. Tracked as TODO for Phase 1b — the
  // signature stays so callers don't need to change when the math lands.
  return computeFrequentistTrust(rows, options);
}
