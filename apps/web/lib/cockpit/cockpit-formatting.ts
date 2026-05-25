export interface CockpitInterfaceReading {
  innerRing: number | null;
  outerRing: number | null;
  transmissionDirection: string;
  totalRecords: number;
  meanTorqueTechnical: number;
  meanTorqueConfidence: number;
  slipCount: number;
  slipRate: number;
  graduationCount: number;
  totalCostUsd: number;
}

export interface CockpitInterfaceSummary {
  total: number;
  weightedTorque: number;
  slipRate: number;
  totalCost: number;
  graduations: number;
}

export function formatTorque(value: number): string {
  return (value * 100).toFixed(0) + "%";
}

export function formatPercent(value: number): string {
  return (value * 100).toFixed(1) + "%";
}

export function formatCost(usd: number): string {
  if (usd === 0) return "$0";
  if (usd < 0.01) return `$${usd.toFixed(4)}`;
  return `$${usd.toFixed(2)}`;
}

export function torqueColor(value: number): string {
  if (value >= 0.9) return "var(--dpf-success)";
  if (value >= 0.6) return "var(--dpf-warning)";
  return "var(--dpf-error)";
}

export function findReadings<T extends { innerRing: number | null; outerRing: number | null }>(
  all: T[],
  innerRing: number,
  outerRing: number,
): T[] {
  return all.filter((r) => r.innerRing === innerRing && r.outerRing === outerRing);
}

export function summarizeInterface(
  readings: CockpitInterfaceReading[],
): CockpitInterfaceSummary | null {
  if (readings.length === 0) {
    return null;
  }
  const total = readings.reduce((acc, r) => acc + r.totalRecords, 0);
  const weightedTorque =
    total === 0
      ? 0
      : readings.reduce((acc, r) => acc + r.meanTorqueTechnical * r.totalRecords, 0) / total;
  const slipCount = readings.reduce((acc, r) => acc + r.slipCount, 0);
  const slipRate = total === 0 ? 0 : slipCount / total;
  const totalCost = readings.reduce((acc, r) => acc + r.totalCostUsd, 0);
  const graduations = readings.reduce((acc, r) => acc + r.graduationCount, 0);
  return { total, weightedTorque, slipRate, totalCost, graduations };
}
