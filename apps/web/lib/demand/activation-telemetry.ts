export type DemandActivationTelemetryItem = {
  demandStage: string | null;
  evidenceCount: number;
  demandScore: number | null;
  scoreExplanationComplete: boolean;
  fundingDecisionCount: number;
};

export type DemandActivationTelemetry = {
  total: number;
  classified: number;
  evidenceLinked: number;
  explainablyScored: number;
  fundingDecided: number;
  classifiedPct: number;
  evidenceLinkedPct: number;
  explainablyScoredPct: number;
  fundingDecidedPct: number;
};

function pct(value: number, total: number): number {
  return total === 0 ? 0 : Math.round((value / total) * 1000) / 10;
}

export function computeDemandActivationTelemetry(
  items: DemandActivationTelemetryItem[],
): DemandActivationTelemetry {
  const total = items.length;
  const classified = items.filter((item) => item.demandStage !== null).length;
  const evidenceLinked = items.filter((item) => item.evidenceCount > 0).length;
  const explainablyScored = items.filter(
    (item) =>
      item.demandScore !== null && item.scoreExplanationComplete,
  ).length;
  const fundingDecided = items.filter(
    (item) => item.fundingDecisionCount > 0,
  ).length;
  return {
    total,
    classified,
    evidenceLinked,
    explainablyScored,
    fundingDecided,
    classifiedPct: pct(classified, total),
    evidenceLinkedPct: pct(evidenceLinked, total),
    explainablyScoredPct: pct(explainablyScored, total),
    fundingDecidedPct: pct(fundingDecided, total),
  };
}
