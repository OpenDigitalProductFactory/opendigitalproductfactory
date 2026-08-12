// MCDA quality gates for principle_decide (BI-1D23EC26).
//
// DPF scores with a weighted-sum model (WSM / SAW), not Saaty AHP
// eigendecomposition. Classical MCDA practice (UK GAF MCDA guide; MAVT)
// still requires:
//   1) options are scored on enough criteria (feature coverage)
//   2) the winner is stable under weight perturbation (sensitivity)
//   3) hard conflicts are not ignored
// These pure helpers compute those signals so autonomy can be gated on
// evidence, not on "a recommendation object exists".
//
// Research: docs/superpowers/research/2026-08-10-decision-vector-science-and-corpus-adequacy.md
//
// Note: this module must NOT import option-scoring.ts (cycle). Sensitivity
// that re-scores lives in option-scoring.decide(); types are duplicated
// lightly via structural typing.

/** Default: each option should score at least this many feature axes. */
export const DEFAULT_MIN_FEATURE_KEYS = 3;

/** Default: ±10% one-at-a-time principle weight swing (MCDA sensitivity). */
export const DEFAULT_SENSITIVITY_EPSILON = 0.1;

export type FeatureCoverageOption = {
  features?: Record<string, number>;
};

export type FeatureCoverageContribution = {
  mode: string;
  missingDimensions?: string[];
};

export type FeatureCoverageScore = {
  contributions: FeatureCoverageContribution[];
};

export type FeatureCoverageReport = {
  minFeatureKeysRequired: number;
  minKeys: number;
  meanKeys: number;
  optionsMeetingFloor: number;
  optionCount: number;
  weak: boolean;
  meanMissingDimensionRatio: number;
};

export type SensitivityReport = {
  epsilon: number;
  unstable: boolean;
  flippingPrincipleIds: string[];
  baselineWinnerId: string;
};

export type AutonomyEligibility = {
  eligible: boolean;
  blockers: string[];
};

export function countFeatureKeys(option: FeatureCoverageOption): number {
  return Object.keys(option.features ?? {}).length;
}

/**
 * Measure whether options carry enough feature axes for structured MCDA.
 * Missing option features pin structured alignment toward zero and collapse
 * discrimination — a dominant cause of repetitive kernel recommendations.
 */
export function measureFeatureCoverage(
  options: FeatureCoverageOption[],
  scores: FeatureCoverageScore[],
  minFeatureKeys: number = DEFAULT_MIN_FEATURE_KEYS,
): FeatureCoverageReport {
  const keyCounts = options.map(countFeatureKeys);
  const optionCount = options.length;
  const minKeys = optionCount === 0 ? 0 : Math.min(...keyCounts);
  const meanKeys =
    optionCount === 0
      ? 0
      : keyCounts.reduce((a, b) => a + b, 0) / optionCount;
  const meeting = keyCounts.filter((k) => k >= minFeatureKeys).length;
  const optionsMeetingFloor = optionCount === 0 ? 0 : meeting / optionCount;

  let missingNum = 0;
  let missingDen = 0;
  for (const s of scores) {
    for (const c of s.contributions) {
      if (c.mode !== "structured") continue;
      const missing = c.missingDimensions?.length ?? 0;
      if (missing > 0) {
        missingNum += missing;
        missingDen += missing + 1;
      } else {
        missingDen += 1;
      }
    }
  }
  const meanMissingDimensionRatio =
    missingDen === 0 ? 0 : missingNum / missingDen;

  const weak =
    optionCount === 0 ||
    minKeys < minFeatureKeys ||
    optionsMeetingFloor < 1;

  return {
    minFeatureKeysRequired: minFeatureKeys,
    minKeys,
    meanKeys,
    optionsMeetingFloor,
    optionCount,
    weak,
    meanMissingDimensionRatio,
  };
}

/**
 * Autonomy eligibility: unattended agents may proceed only when the
 * recommendation is high-confidence, coverage-adequate, sensitivity-stable,
 * and free of commandment conflict.
 */
export function evaluateAutonomyEligibility(input: {
  recommendation: { confidence: "high" | "low" } | null;
  flags: {
    commandmentConflict: boolean;
    structuredCoverage: "strong" | "weak";
    insufficientSignal?: boolean;
    featureCoverageWeak?: boolean;
    sensitivityUnstable?: boolean;
  };
}): AutonomyEligibility {
  const blockers: string[] = [];
  if (!input.recommendation) blockers.push("no_recommendation");
  if (input.flags.insufficientSignal) blockers.push("insufficient_signal");
  if (input.recommendation?.confidence !== "high") {
    blockers.push("confidence_not_high");
  }
  if (input.flags.commandmentConflict) blockers.push("commandment_conflict");
  if (input.flags.structuredCoverage === "weak") {
    blockers.push("structured_coverage_weak");
  }
  if (input.flags.featureCoverageWeak) blockers.push("feature_coverage_weak");
  if (input.flags.sensitivityUnstable) blockers.push("sensitivity_unstable");

  return { eligible: blockers.length === 0, blockers };
}
