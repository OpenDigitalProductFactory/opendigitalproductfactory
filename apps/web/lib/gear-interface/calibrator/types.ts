// apps/web/lib/gear-interface/calibrator/types.ts
//
// Reduction Gear Phase 1 — Calibrator type surface.
//
// The unit of trust is the capability triple plus the interface it crosses.
// Spec §6.1: trust is maintained per
//   {agentId, capabilityName, archetypeContext, interfaceClass, innerRing, outerRing, autonomyLevel}
// — rollups by capability / archetype / ring are query projections, not stored keys.
//
// Spec: docs/superpowers/specs/2026-05-24-reduction-gear-architecture-design.md §6.1

import type { AutonomyTier, InterfaceClass } from "../types";

/**
 * The full key the Calibrator scores over. The agentIdForTriple field on
 * GearInterface is the canonical agent identifier; capability + archetype
 * complete the spec §3.3 capability triple. The interface fields scope the
 * trust to where the work crossed the gear-train boundary.
 */
export interface CalibrationKey {
  agentIdForTriple: string;
  capabilityName: string;
  /** null is honest at Ring 1→2 and explicitly archetype-agnostic work. */
  archetypeContext: string | null;
  interfaceClass: InterfaceClass;
  innerRing: number | null;
  outerRing: number | null;
  /** Current autonomy tier at the interface — null when the row predates Governor scoring. */
  autonomyLevel: AutonomyTier | null;
}

/**
 * Trust reading for one CalibrationKey over a defined window.
 * Score is null when sampleSize is 0 — fail-closed honesty.
 */
export interface TrustReading {
  /** Mean torqueTechnical over the window, optionally HITL-weighted. Null when empty. */
  score: number | null;
  /** How many rows fed the score. */
  sampleSize: number;
  /** 0..1 — how confident the Calibrator is in the score itself (sample-size adequacy). */
  confidence: number;
  /** Most recent recordedAt in the window for this key. Null when empty. */
  lastSeenAt: Date | null;
  /** Number of rows in the window with torqueTechnical < 0.5 — the "recent failure" signal. */
  recentFailureCount: number;
  /** Number of rows graded by a human (graderType='human'). */
  humanGradedCount: number;
}

/**
 * Tunables for one Calibrator read. All have safe defaults so callers don't
 * have to hand-tune unless they know they need to.
 */
export interface CalibratorOptions {
  /** Default 20. Rolling window size for the frequentist score. */
  rollingWindow?: number;
  /** Default 20. Sample size at which confidence becomes 1.0. */
  confidenceAdequateSampleSize?: number;
  /**
   * Default 1.5. Multiplier applied to torqueTechnical when graderType='human'
   * — honors "HITL is the training signal" per spec §6.3. Set to 1.0 to disable.
   */
  humanGradeWeight?: number;
  /**
   * Bayesian scaffolding flag. When true the read returns the same frequentist
   * answer for now — the prior+update math lands in Phase 1b when the
   * BayesianTrust signature is wired. Spec §6.1.
   */
  useBayesian?: boolean;
}

export const DEFAULT_OPTIONS: Required<CalibratorOptions> = {
  rollingWindow: 20,
  confidenceAdequateSampleSize: 20,
  humanGradeWeight: 1.5,
  useBayesian: false,
};
