// apps/web/lib/gear-interface/governor/thresholds.ts
//
// Reduction Gear Phase 1 — graduation threshold table.
//
// Phase 1 defaults; operators can override via PlatformConfig (key
// `gear_interface.graduation_thresholds`) once the override surface lands.
// Phase 1 leaves the override unwired — the defaults are deliberately
// conservative so the platform never elevates a triple it shouldn't.
//
// Spec: docs/superpowers/specs/2026-05-24-reduction-gear-architecture-design.md §6.4

import type { AutonomyTier } from "../types";

export interface GraduationThreshold {
  /** Minimum trust score to qualify. */
  minScore: number;
  /** Minimum sample size — protects against small-sample false confidence. */
  minSampleSize: number;
  /** Maximum failure count in the rolling window — bars elevation on recent regressions. */
  maxRecentFailures: number;
  /** Minimum calibration confidence — fail-closed when the Calibrator itself is uncertain. */
  minConfidence: number;
}

/**
 * Threshold to graduate FROM the keyed tier TO the next-higher tier.
 * Order of elevation: hitl-required → hitl-fallback → auto-confirm → auto-silent.
 * auto-silent has no higher tier — it's the top.
 */
export const DEFAULT_GRADUATION_THRESHOLDS: Record<
  Exclude<AutonomyTier, "auto-silent">,
  GraduationThreshold
> = {
  "hitl-required": {
    minScore: 0.85,
    minSampleSize: 10,
    maxRecentFailures: 1,
    minConfidence: 0.5,
  },
  "hitl-fallback": {
    minScore: 0.95,
    minSampleSize: 20,
    maxRecentFailures: 0,
    minConfidence: 0.9,
  },
  "auto-confirm": {
    minScore: 0.98,
    minSampleSize: 50,
    maxRecentFailures: 0,
    minConfidence: 1.0,
  },
};

/**
 * The next-higher tier in the autonomy ladder. Returns null for auto-silent
 * (top of the ladder — no further elevation possible).
 */
export const NEXT_TIER: Record<AutonomyTier, AutonomyTier | null> = {
  "hitl-required": "hitl-fallback",
  "hitl-fallback": "auto-confirm",
  "auto-confirm": "auto-silent",
  "auto-silent": null,
};

/**
 * Score below which the Governor recommends BLOCKING the triple — clear
 * failure pattern, do not even gate via HITL. Tunable via PlatformConfig
 * later. Phase 1 default: trust below 0.3 with adequate sample size.
 */
export const BLOCK_THRESHOLD = {
  maxScore: 0.3,
  minSampleSize: 5,
} as const;

/**
 * Recent-failure count above which the Governor recommends ESCALATING
 * (human attention beyond normal HITL — call a senior operator or owner).
 */
export const ESCALATE_THRESHOLD = {
  recentFailures: 3,
} as const;
