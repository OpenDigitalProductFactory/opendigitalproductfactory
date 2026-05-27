import type {
  ScoreTrustVectorInput,
  TrustAction,
  TrustAssessment,
  TrustDimension,
  TrustDimensionKey,
  TrustStatementKind,
  TrustTier,
} from "./types";

const LOW_DIMENSION_THRESHOLD = 0.4;

const CAP_ORDER: TrustDimensionKey[] = [
  "conflictContradiction",
  "runtimeAvailability",
  "freshness",
  "evidenceGrade",
  "coverageCompleteness",
];

export function scoreTrustVector(input: ScoreTrustVectorInput): TrustAssessment {
  const dimensions = input.dimensions.map(toScoredDimension);
  const applicable = dimensions.filter((dimension) => dimension.score !== null);
  const overallScore = calculateOverallScore(applicable);
  const baseTier = tierFromScore(overallScore);
  const capDimension = findCapDimension(dimensions);
  const freshnessLow = isDimensionLow(dimensions, "freshness");
  const graphTraversalLow = isDimensionLow(dimensions, "graphTraversalDepth");
  const highRisk = input.riskLevel === "high" || input.riskLevel === "critical";

  const cappedTier = applyTierCaps(baseTier, capDimension);
  const statementKind = determineStatementKind({
    tier: cappedTier,
    capKey: capDimension?.key,
    freshnessLow,
    graphTraversalLow,
  });
  const action = determineAction({
    tier: cappedTier,
    capKey: capDimension?.key,
    statementKind,
    highRisk,
  });
  const primaryRationale = choosePrimaryRationale(dimensions, capDimension, cappedTier);

  return {
    kind: "data-trust-vector",
    schemaVersion: 1,
    subject: input.subject,
    statementKind,
    tier: cappedTier,
    overallScore,
    action,
    asOf: input.asOf,
    summary: `${capitalize(cappedTier)} trust`,
    primaryRationale,
    dimensions,
    sourceSummary: input.sourceSummary ?? `${input.subject.label} assessed from ${applicable.length} trust dimensions.`,
    ...(input.auditRef ? { auditRef: input.auditRef } : {}),
  };
}

function toScoredDimension(input: ScoreTrustVectorInput["dimensions"][number]): TrustDimension {
  const score = input.score === null ? null : clampScore(input.score);

  return {
    key: input.key,
    label: input.label,
    score,
    weight: input.weight ?? 1,
    rationale: input.rationale,
    tier: tierFromScore(score),
    ...(input.measuredAt ? { measuredAt: input.measuredAt } : {}),
    ...(input.expiresAt ? { expiresAt: input.expiresAt } : {}),
    evidenceRefs: input.evidenceRefs ?? [],
  };
}

function calculateOverallScore(dimensions: TrustDimension[]): number | null {
  if (dimensions.length === 0) return null;

  let weightedScore = 0;
  let totalWeight = 0;
  for (const dimension of dimensions) {
    if (dimension.score === null) continue;
    const weight = Math.max(0, dimension.weight);
    weightedScore += dimension.score * weight;
    totalWeight += weight;
  }

  if (totalWeight === 0) return null;

  return Number((weightedScore / totalWeight).toFixed(2));
}

function tierFromScore(score: number | null): TrustTier {
  if (score === null) return "unknown";
  if (score >= 0.8) return "high";
  if (score >= 0.6) return "medium";
  return "low";
}

function findCapDimension(dimensions: TrustDimension[]): TrustDimension | null {
  for (const key of CAP_ORDER) {
    const dimension = dimensions.find((entry) => entry.key === key && entry.score !== null);
    if (dimension && (dimension.score ?? 1) < LOW_DIMENSION_THRESHOLD) {
      return dimension;
    }
  }

  return null;
}

function isDimensionLow(dimensions: TrustDimension[], key: TrustDimensionKey): boolean {
  const dimension = dimensions.find((entry) => entry.key === key);
  return dimension?.score !== null && (dimension?.score ?? 1) < LOW_DIMENSION_THRESHOLD;
}

function applyTierCaps(baseTier: TrustTier, capDimension: TrustDimension | null): TrustTier {
  if (!capDimension) return baseTier;

  if (capDimension.key === "freshness") {
    return baseTier === "high" ? "medium" : baseTier;
  }

  return "low";
}

function determineStatementKind(input: {
  tier: TrustTier;
  capKey?: TrustDimensionKey;
  freshnessLow: boolean;
  graphTraversalLow: boolean;
}): TrustStatementKind {
  if (input.capKey === "conflictContradiction" || input.capKey === "runtimeAvailability") {
    return "low-confidence-result";
  }

  if (input.freshnessLow) {
    return "last-known-fact";
  }

  if (input.graphTraversalLow) {
    return "inferred-result";
  }

  if (input.tier === "low" || input.tier === "unknown") {
    return "low-confidence-result";
  }

  return "current-fact";
}

function determineAction(input: {
  tier: TrustTier;
  capKey?: TrustDimensionKey;
  statementKind: TrustStatementKind;
  highRisk: boolean;
}): TrustAction {
  if (input.capKey === "conflictContradiction") return "escalate";
  if (input.capKey === "runtimeAvailability") return "defer";
  if (input.capKey === "evidenceGrade") return "defer";
  if (input.capKey === "freshness") {
    return input.highRisk ? "refresh-required" : "warn-stale";
  }
  if (input.capKey === "coverageCompleteness") return "qualify";
  if (input.tier === "unknown") return "defer";
  if (input.tier === "low") return "qualify";
  if (input.statementKind === "inferred-result") return "qualify";

  return input.tier === "high" ? "present" : "qualify";
}

function choosePrimaryRationale(
  dimensions: TrustDimension[],
  capDimension: TrustDimension | null,
  tier: TrustTier,
): string {
  if (capDimension) return capDimension.rationale;
  if (tier === "high") return "All trust dimensions are strong.";

  const lowest = [...dimensions]
    .filter((dimension) => dimension.score !== null)
    .sort((a, b) => (a.score ?? 0) - (b.score ?? 0))[0];

  return lowest?.rationale ?? "No applicable trust dimensions were available.";
}

function clampScore(score: number): number {
  if (Number.isNaN(score)) return 0;
  return Math.min(1, Math.max(0, score));
}

function capitalize(value: string): string {
  return `${value.slice(0, 1).toUpperCase()}${value.slice(1)}`;
}
