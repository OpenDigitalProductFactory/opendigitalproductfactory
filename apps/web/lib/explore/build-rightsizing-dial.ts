// apps/web/lib/explore/build-rightsizing-dial.ts
//
// EP-QUALITY-RIGHTSIZING P2 (BI-9AF9595A) — the golden-triangle live dial for
// Build Studio right-sizing.
//
// Spec: docs/superpowers/specs/2026-06-23-quality-first-risk-aware-build-rightsizing-design.md §4.3
//
// A build carries a Cost/Quality/Time posture (global default in PlatformConfig,
// optional per-deliverable override). This module COMPOSES the existing
// golden-triangle compiler with P1's deliverable-sensitivity axis to produce the
// final build sizing — it never re-implements routing or the matrix:
//
//   matrix cell (type, size)          ── P1 baseline
//     ⊔ sensitivity escalation         ── P1, monotonic (HIGH → deepest)
//       ⊔ golden-triangle dial         ── P2, the operator's Cost/Quality/Time
//
// Every layer can only RAISE rigor (monotonic ⊔ = max). Crucially the sensitivity
// is fed to the compiler as a `minimumTierFloor`, so a Cost/Speed dial CANNOT
// discount a sensitive deliverable below its floor — "Cost/Speed capped by the
// risk axis", implemented through the compiler's own precedence rather than a
// second clamp. Pure + deterministic (no I/O); the PlatformConfig read lives in
// build-studio-config.ts.

import { compileGoldenTrianglePolicy } from "@/lib/golden-triangle/compile";
import type { GoldenTrianglePreference } from "@/lib/golden-triangle/types";
import type { QualityTier } from "@/lib/routing/quality-tiers";

import {
  getModelTier,
  getProcessPolicy,
  type BuildModelTier,
  type BuildProcessSize,
  type BuildProcessType,
  type DeliverableSensitivity,
  type LifecyclePolicy,
  type ReviewIntensity,
} from "./build-process-matrix";

/**
 * The default build posture — PINNED to Quality (BI-9AF9595A): a build defaults
 * to the strongest model + thorough review unless the operator dials it down.
 * This is the global default returned when PlatformConfig holds no override.
 */
export const DEFAULT_BUILD_POSTURE: GoldenTrianglePreference = {
  preset: "assured",
  qualityWeight: 0.8,
  costWeight: 0.1,
  timeWeight: 0.1,
};

/** Validate an untrusted value (PlatformConfig JSON / a per-build plan override)
 *  as a GoldenTrianglePreference. Returns null when the shape is wrong, so callers
 *  fall back to the Quality default. */
export function coerceBuildPosture(value: unknown): GoldenTrianglePreference | null {
  if (!value || typeof value !== "object") return null;
  const v = value as Record<string, unknown>;
  if (
    typeof v.qualityWeight === "number" &&
    typeof v.costWeight === "number" &&
    typeof v.timeWeight === "number" &&
    typeof v.preset === "string"
  ) {
    return {
      qualityWeight: v.qualityWeight,
      costWeight: v.costWeight,
      timeWeight: v.timeWeight,
      preset: v.preset as GoldenTrianglePreference["preset"],
    };
  }
  return null;
}

const REVIEW_RANK: Record<ReviewIntensity, number> = { minimal: 0, standard: 1, thorough: 2 };
const TIER_RANK: Record<QualityTier, number> = { basic: 0, adequate: 1, strong: 2, frontier: 3 };

function maxReview(a: ReviewIntensity, b: ReviewIntensity): ReviewIntensity {
  return REVIEW_RANK[a] >= REVIEW_RANK[b] ? a : b;
}

/**
 * Map a deliverable's sensitivity to the compiler's tier FLOOR. The dial's
 * Cost/Speed axes compile to a lower `minimumTier`, but the compiler raises it
 * back to at least this floor — so a sensitive deliverable keeps a capable model
 * regardless of the posture. `low` adds no floor (undefined).
 */
export function sensitivityToTierFloor(s: DeliverableSensitivity): QualityTier | undefined {
  if (s === "high") return "frontier";
  if (s === "elevated") return "strong";
  return undefined;
}

/** A compiled QualityTier → the build's coarse local|robust tier (strong+ = robust). */
function tierToBuildTier(t: QualityTier | undefined): BuildModelTier {
  return t != null && TIER_RANK[t] >= TIER_RANK.strong ? "robust" : "local";
}

/** The dial's review intensity, read off the compiled orchestration budget. */
function budgetToReview(
  deliberationPattern: string | undefined,
  verificationDepth: string | undefined,
): ReviewIntensity {
  if (deliberationPattern === "debate" || verificationDepth === "deep") return "thorough";
  if (deliberationPattern === "review" || verificationDepth === "shallow") return "standard";
  return "minimal";
}

export type BuildSizingResolution = {
  modelTier: BuildModelTier;
  policy: LifecyclePolicy;
  /** Plain-language account of what the dial compiled to (for the operator UI). */
  postureExplanation: string;
};

/**
 * Resolve the final build sizing by composing the (type, size) matrix baseline,
 * P1's sensitivity escalation, and the golden-triangle dial — monotonically.
 *
 * The DIAL provides the quality-first lift (a Quality posture → robust + thorough;
 * the default), so this does NOT pass P1's `qualityFirst` boolean — the operator's
 * posture is the control. Sensitivity is applied twice, both monotonic and
 * mutually reinforcing: once via P1 (gate/phase escalation for HIGH) and once as
 * the compiler's tier floor (so Cost/Speed can't undercut it).
 */
export function resolveBuildSizing(input: {
  type: BuildProcessType | string | null | undefined;
  size: BuildProcessSize | string | null | undefined;
  posture: GoldenTrianglePreference;
  sensitivity: DeliverableSensitivity;
}): BuildSizingResolution {
  const { type, size, posture, sensitivity } = input;

  // 1. P1 baseline: the matrix cell escalated by sensitivity (no qualityFirst —
  //    the dial owns the quality lift).
  const p1Opts = { sensitivity };
  const basePolicy = getProcessPolicy(type, size, p1Opts);
  const baseTier = getModelTier(type, size, p1Opts);

  // 2. The dial: compile the posture, FLOORED by the sensitivity tier.
  const compiled = compileGoldenTrianglePolicy({
    preference: posture,
    taskClass: "build",
    authorityScope: { kind: "wsid" },
    policyConstraints: { minimumTierFloor: sensitivityToTierFloor(sensitivity) },
  });
  const dialTier = tierToBuildTier(compiled.postureOverride.minimumTier);
  const dialReview = budgetToReview(
    compiled.orchestrationBudget.deliberationPattern,
    compiled.orchestrationBudget.verificationDepth,
  );

  // 3. Monotonic ⊔: each layer can only raise rigor.
  const modelTier: BuildModelTier = baseTier === "robust" || dialTier === "robust" ? "robust" : "local";
  const reviewIntensity = maxReview(basePolicy.reviewIntensity, dialReview);
  const policy =
    reviewIntensity !== basePolicy.reviewIntensity ? { ...basePolicy, reviewIntensity } : basePolicy;

  return { modelTier, policy, postureExplanation: compiled.explanation };
}
