// apps/web/lib/gear-interface/governor/index.ts
//
// Reduction Gear Phase 1 — Autonomy Governor facade.
//
// "WWMD generalized" per spec §6.2. Every autonomy-affecting gate at any ring
// interface calls governor.consult() to get one of five recommendations:
//
//   'allow-auto'         — Calibrator says high trust, sample adequate, no recent failures
//   'allow-with-notify'  — moderate trust + adequate sample; safe but operator should see it
//   'require-hitl'       — default; insufficient trust or sample to elevate
//   'escalate'           — recent failure pattern warrants senior operator review
//   'block'              — clear failure pattern OR explicit veto cooldown
//
// These map to the GearInterface autonomy enum per spec §6.2 table — that
// mapping lives in `decideAutonomyTier()` here so callers don't reimplement
// it. For Phase 1 the Governor is a DECISION FACADE — it does NOT replace
// existing gate models (build-studio-gate, value-stream-hitl, release gates).
// Those remain authoritative for their domains; the Governor records the
// outcome + calibration signal alongside.
//
// Spec: docs/superpowers/specs/2026-05-24-reduction-gear-architecture-design.md §6.2
// BI:   BI-861C4959

import type { AutonomyTier } from "../types";
import { getTrustForTriple } from "../calibrator";
import type {
  CalibrationKey,
  CalibratorOptions,
  TrustReading,
} from "../calibrator";
import {
  BLOCK_THRESHOLD,
  DEFAULT_GRADUATION_THRESHOLDS,
  ESCALATE_THRESHOLD,
  NEXT_TIER,
  type GraduationThreshold,
} from "./thresholds";

export type GovernorVerdict =
  | "allow-auto"
  | "allow-with-notify"
  | "require-hitl"
  | "escalate"
  | "block";

export interface GovernorConsultInput {
  /** The capability triple + interface + autonomy this consult applies to. */
  triple: CalibrationKey;
  /** What the caller is about to do — e.g. "complete-phase-build", "ship-feature-build". */
  action: string;
  /** Optional per-call tuning of Calibrator behavior (rollingWindow etc.). */
  calibratorOptions?: CalibratorOptions;
  /**
   * Optional override threshold for the current tier. Phase 1 ignores
   * PlatformConfig overrides; this hook is exposed so unit tests + later
   * surfaces can inject without re-deriving from defaults.
   */
  thresholdOverride?: GraduationThreshold;
  /**
   * Default 'operator-notify' — `allow-auto` maps to `auto-confirm` so
   * Cockpit shows the row. Pass 'silent' to map to `auto-silent`.
   */
  notifyPolicy?: "operator-notify" | "silent";
}

export interface GovernorConsultResult {
  verdict: GovernorVerdict;
  /** Recommended autonomy tier per spec §6.2 mapping. */
  recommendedTier: AutonomyTier;
  /** The trust reading the verdict was based on. */
  trust: TrustReading;
  /** Whether this consult recommends elevating the triple to its next tier. */
  graduationEligible: boolean;
  /**
   * Short rationale string — used for `rationale` on emitted GearInterface
   * graduation/veto rows. Phase 1 keeps this human-readable; Phase 2 may
   * structure it for the Cockpit.
   */
  rationale: string;
}

/**
 * Map a Governor verdict to the GearInterface autonomy tier enum per spec §6.2.
 * `escalate` and `block` both surface as `hitl-required` from a tier-storage
 * perspective — the verdict itself signals the escalation chain / veto separately.
 */
export function decideAutonomyTier(
  verdict: GovernorVerdict,
  notifyPolicy: "operator-notify" | "silent" = "operator-notify",
): AutonomyTier {
  switch (verdict) {
    case "allow-auto":
      return notifyPolicy === "silent" ? "auto-silent" : "auto-confirm";
    case "allow-with-notify":
      return "hitl-fallback";
    case "require-hitl":
    case "escalate":
    case "block":
      return "hitl-required";
  }
}

/**
 * Pure evaluation — given a trust reading + the current autonomy tier, decide
 * the Governor's verdict. Exposed for unit testing the decision logic without
 * a DB round-trip.
 */
export function evaluateVerdict(
  trust: TrustReading,
  currentTier: AutonomyTier,
  thresholdOverride?: GraduationThreshold,
): { verdict: GovernorVerdict; graduationEligible: boolean; rationale: string } {
  // Fail-closed: empty / null score ⇒ stay HITL. Never elevate without data.
  if (trust.score === null || trust.sampleSize === 0) {
    return {
      verdict: "require-hitl",
      graduationEligible: false,
      rationale: "no calibration data — fail-closed",
    };
  }

  // Block: clear failure pattern with enough samples to be confident.
  if (
    trust.score <= BLOCK_THRESHOLD.maxScore &&
    trust.sampleSize >= BLOCK_THRESHOLD.minSampleSize
  ) {
    return {
      verdict: "block",
      graduationEligible: false,
      rationale: `trust ${(trust.score * 100).toFixed(0)}% across ${trust.sampleSize} samples is below block threshold`,
    };
  }

  // Escalate: recent failure pattern warrants senior review.
  if (trust.recentFailureCount >= ESCALATE_THRESHOLD.recentFailures) {
    return {
      verdict: "escalate",
      graduationEligible: false,
      rationale: `${trust.recentFailureCount} recent failures in window of ${trust.sampleSize}`,
    };
  }

  // Graduation evaluation — is this triple eligible to elevate FROM currentTier?
  const nextTier = NEXT_TIER[currentTier];
  if (nextTier === null) {
    // At the top of the ladder already. Stay where we are.
    return {
      verdict: "allow-auto",
      graduationEligible: false,
      rationale: `${currentTier} is the top autonomy tier`,
    };
  }

  const threshold =
    thresholdOverride ??
    DEFAULT_GRADUATION_THRESHOLDS[currentTier as keyof typeof DEFAULT_GRADUATION_THRESHOLDS];

  const meetsScore = trust.score >= threshold.minScore;
  const meetsSample = trust.sampleSize >= threshold.minSampleSize;
  const meetsFailures = trust.recentFailureCount <= threshold.maxRecentFailures;
  const meetsConfidence = trust.confidence >= threshold.minConfidence;
  const eligible = meetsScore && meetsSample && meetsFailures && meetsConfidence;

  if (eligible) {
    // Eligible to graduate. Verdict matches the NEXT tier semantics.
    const verdict: GovernorVerdict =
      nextTier === "hitl-fallback"
        ? "allow-with-notify"
        : nextTier === "auto-confirm" || nextTier === "auto-silent"
          ? "allow-auto"
          : "require-hitl";
    return {
      verdict,
      graduationEligible: true,
      rationale: `${currentTier} → ${nextTier}: trust ${(trust.score * 100).toFixed(0)}% across ${trust.sampleSize} samples`,
    };
  }

  // Not eligible — stay at the current tier's verdict.
  const verdict: GovernorVerdict =
    currentTier === "hitl-required"
      ? "require-hitl"
      : currentTier === "hitl-fallback"
        ? "allow-with-notify"
        : "allow-auto";

  return {
    verdict,
    graduationEligible: false,
    rationale: [
      `not eligible to graduate ${currentTier} → ${nextTier}:`,
      !meetsScore && `score ${(trust.score * 100).toFixed(0)}% < ${(threshold.minScore * 100).toFixed(0)}%`,
      !meetsSample && `samples ${trust.sampleSize} < ${threshold.minSampleSize}`,
      !meetsFailures && `failures ${trust.recentFailureCount} > ${threshold.maxRecentFailures}`,
      !meetsConfidence && `confidence ${trust.confidence.toFixed(2)} < ${threshold.minConfidence.toFixed(2)}`,
    ]
      .filter(Boolean)
      .join(" "),
  };
}

/**
 * Read trust + apply the verdict logic. Public Governor entry point.
 *
 * Returns the verdict, recommended tier, and the trust reading the decision
 * was based on so callers can record it on the resulting GearInterface
 * graduation/veto record without an extra DB read.
 */
export async function consult(input: GovernorConsultInput): Promise<GovernorConsultResult> {
  const currentTier: AutonomyTier = input.triple.autonomyLevel ?? "hitl-required";
  const trust = await getTrustForTriple(input.triple, input.calibratorOptions);
  const { verdict, graduationEligible, rationale } = evaluateVerdict(
    trust,
    currentTier,
    input.thresholdOverride,
  );
  const recommendedTier = decideAutonomyTier(verdict, input.notifyPolicy ?? "operator-notify");

  return { verdict, recommendedTier, trust, graduationEligible, rationale };
}

export {
  BLOCK_THRESHOLD,
  DEFAULT_GRADUATION_THRESHOLDS,
  ESCALATE_THRESHOLD,
  NEXT_TIER,
} from "./thresholds";
export type { GraduationThreshold } from "./thresholds";
