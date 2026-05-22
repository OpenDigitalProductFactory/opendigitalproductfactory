export const CAPABILITY_MATURITY_RISK_TIERS = [
  "critical",
  "elevated",
  "standard",
  "low",
] as const;
export type CapabilityMaturityRiskTier =
  (typeof CAPABILITY_MATURITY_RISK_TIERS)[number];

export const CAPABILITY_MATURITY_CONFIDENCE_GRADES = [
  "verified",
  "evidenced",
  "claimed",
  "stale",
] as const;
export type CapabilityMaturityConfidenceGrade =
  (typeof CAPABILITY_MATURITY_CONFIDENCE_GRADES)[number];

export const CAPABILITY_MATURITY_CATEGORIES = [
  "runtime",
  "identity_authority",
  "tool_gateway",
  "data_plane",
  "budget_spend",
  "evidence_eval",
  "human_override",
  "composition_helper",
] as const;
export type CapabilityMaturityCategory =
  (typeof CAPABILITY_MATURITY_CATEGORIES)[number];

export const CAPABILITY_STRATEGIC_OWNERSHIP = [
  "owned_core",
  "embedded_accelerator",
  "boundary_adapter",
  "avoid",
] as const;
export type CapabilityStrategicOwnership =
  (typeof CAPABILITY_STRATEGIC_OWNERSHIP)[number];

export const CAPABILITY_INSTALL_SCOPES = [
  "canonical",
  "dpf_dogfood",
  "customer_overlay",
] as const;
export type CapabilityInstallScope = (typeof CAPABILITY_INSTALL_SCOPES)[number];

export const CAPABILITY_PRODUCTIZATION_STATUSES = [
  "not_eligible",
  "eligible",
  "candidate",
  "productized",
] as const;
export type CapabilityProductizationStatus =
  (typeof CAPABILITY_PRODUCTIZATION_STATUSES)[number];

const DAY_MS = 24 * 60 * 60 * 1000;

export function deriveMvpTargetScore(
  riskTier: CapabilityMaturityRiskTier,
): number {
  return riskTier === "critical" || riskTier === "elevated" ? 4 : 3;
}

export function deriveConfidenceGrade(input: {
  now: Date;
  evidenceFreshnessAt: Date | null;
  lastGovernanceReviewAt: Date | null;
  hasContinuousEvidence: boolean;
}): CapabilityMaturityConfidenceGrade {
  const ageDays = (at: Date | null): number | null =>
    at === null
      ? null
      : Math.floor((input.now.getTime() - at.getTime()) / DAY_MS);

  const evidenceAge = ageDays(input.evidenceFreshnessAt);
  const reviewAge = ageDays(input.lastGovernanceReviewAt);

  if (
    reviewAge !== null
    && reviewAge <= 30
    && (evidenceAge !== null || input.hasContinuousEvidence)
  ) {
    return "verified";
  }

  if (
    evidenceAge !== null
    && evidenceAge <= 30
    && input.hasContinuousEvidence
  ) {
    return "evidenced";
  }

  if (
    (evidenceAge !== null && evidenceAge > 30)
    || (reviewAge !== null && reviewAge > 90)
  ) {
    return "stale";
  }

  return "claimed";
}

export function deriveEffectiveMaturity(input: {
  maturityScore: number;
  dependencyEffectiveMaturities: number[];
  confidenceGrade: CapabilityMaturityConfidenceGrade;
}): number {
  const dependencyFloor = input.dependencyEffectiveMaturities.length > 0
    ? Math.min(...input.dependencyEffectiveMaturities)
    : input.maturityScore;
  const bounded = Math.min(input.maturityScore, dependencyFloor);

  return input.confidenceGrade === "stale" ? Math.max(0, bounded - 1) : bounded;
}

export function validateCapabilityDependencyGraph(
  records: Array<{ id: string; dependsOnIds: string[] }>,
): void {
  const graph = new Map(
    records.map((record) => [record.id, record.dependsOnIds]),
  );
  const visiting = new Set<string>();
  const visited = new Set<string>();

  function visit(id: string, path: string[]): void {
    if (visited.has(id)) return;
    if (visiting.has(id)) {
      throw new Error(
        `Capability maturity dependency cycle detected: ${[...path, id].join(" -> ")}`,
      );
    }

    visiting.add(id);
    for (const dependencyId of graph.get(id) ?? []) {
      visit(dependencyId, [...path, id]);
    }
    visiting.delete(id);
    visited.add(id);
  }

  for (const record of records) {
    visit(record.id, []);
  }
}
