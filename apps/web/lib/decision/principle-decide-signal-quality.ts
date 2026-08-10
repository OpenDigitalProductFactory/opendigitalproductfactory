// Build principle_decide signalQuality + operator summary (BI-1D23EC26).
// Extracted from principle-decide-pack so the pack stays under the module-size ceiling.

import type { DecisionResult } from "./option-scoring";

export type PrincipleDecideSignalQuality = {
  usable: boolean;
  autonomyEligible: boolean;
  autonomyBlockers: string[];
  insufficientSignal: boolean | undefined;
  retrievalDegraded: boolean;
  structuredCoverage: DecisionResult["flags"]["structuredCoverage"];
  semanticFallbackRatio: number;
  featureCoverageWeak: boolean;
  sensitivityUnstable: boolean;
  featureCoverage: DecisionResult["flags"]["featureCoverage"] | null;
  sensitivity: DecisionResult["flags"]["sensitivity"] | null;
  optionsWithFeatures: number;
  optionCount: number;
  advisory: string | null;
};

const DEGRADED_ADVISORY =
  "EMBEDDING PROVIDER UNAVAILABLE — only commandment-tier principles were consulted; " +
  "core and contextual retrieval returned nothing because the query could not be embedded, " +
  "NOT because no relevant principle exists. Treat this as an incomplete consult, not a verdict. " +
  "Restore the provider (docker model pull ai/nomic-embed-text-v1.5), then re-run.";

export function buildPrincipleDecideSignalQuality(input: {
  result: DecisionResult;
  retrievalDegraded: boolean;
  optionsWithFeatures: number;
  optionCount: number;
}): PrincipleDecideSignalQuality {
  const { result, retrievalDegraded, optionsWithFeatures, optionCount } = input;
  const usable =
    !result.flags.insufficientSignal &&
    result.recommendation !== null &&
    !retrievalDegraded;
  const autonomyEligible = result.flags.autonomyEligible === true && usable;

  const advisory = usable
    ? autonomyEligible
      ? null
      : `Recommendation is advisory only — autonomyEligible=false (${(result.flags.autonomyBlockers ?? []).join(", ") || "quality gates"}). Do not auto-execute without operator ratification.`
    : retrievalDegraded
      ? DEGRADED_ADVISORY
      : optionsWithFeatures === 0
        ? "NO OPTION SUPPLIED `features`, so every principle scored exactly 0. Governance commandments carry full dimension vectors, so scoring takes the structured path and the semantic fallback never fires for them. Re-call with a features map per option — this is not a neutral or tie result."
        : "Signal was too weak to recommend. Widen per-option `features` coverage across the dimensions the applied principles actually weigh (see each contribution's missingDimensions), or decide by human judgement.";

  return {
    usable,
    autonomyEligible,
    autonomyBlockers: result.flags.autonomyBlockers ?? [],
    insufficientSignal: result.flags.insufficientSignal,
    retrievalDegraded,
    structuredCoverage: result.flags.structuredCoverage,
    semanticFallbackRatio: result.flags.semanticFallbackRatio,
    featureCoverageWeak: result.flags.featureCoverageWeak === true,
    sensitivityUnstable: result.flags.sensitivityUnstable === true,
    featureCoverage: result.flags.featureCoverage ?? null,
    sensitivity: result.flags.sensitivity ?? null,
    optionsWithFeatures,
    optionCount,
    advisory,
  };
}

export function buildPrincipleDecideSummary(input: {
  usable: boolean;
  retrievalDegraded: boolean;
  result: DecisionResult;
  signalQuality: PrincipleDecideSignalQuality;
  governingProfileKind: string;
}): string {
  const {
    usable,
    retrievalDegraded,
    result,
    signalQuality,
    governingProfileKind,
  } = input;
  if (usable && result.recommendation) {
    return `Recommends ${result.recommendation.optionId} (confidence: ${result.recommendation.confidence}, composite ${result.recommendation.composite.toFixed(3)}; autonomyEligible: ${signalQuality.autonomyEligible}; governing profile: ${governingProfileKind})`;
  }
  if (retrievalDegraded) {
    return `NO RECOMMENDATION — signalQuality.retrievalDegraded=true. ${DEGRADED_ADVISORY}`;
  }
  return `NO RECOMMENDATION — signalQuality.usable=false. ${result.reasoning} ${signalQuality.advisory}`;
}
