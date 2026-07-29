export interface OperationsLatencySummary {
  count: number;
  minMs: number;
  maxMs: number;
  p50Ms: number;
  p75Ms: number;
  p95Ms: number;
}

function nearestRank(sorted: number[], percentile: number): number {
  const index = Math.max(0, Math.ceil((percentile / 100) * sorted.length) - 1);
  return sorted[index] ?? 0;
}

export function summarizeOperationsLatency(samples: number[]): OperationsLatencySummary | null {
  const sorted = samples.filter(Number.isFinite).map((value) => Math.max(0, value)).sort((a, b) => a - b);
  if (sorted.length === 0) return null;
  return {
    count: sorted.length,
    minMs: sorted[0],
    maxMs: sorted[sorted.length - 1],
    p50Ms: nearestRank(sorted, 50),
    p75Ms: nearestRank(sorted, 75),
    p95Ms: nearestRank(sorted, 95),
  };
}

export function formatOperationsServerTiming(input: {
  durationMs: number;
  queryCount: number;
}): string {
  return `operations;dur=${input.durationMs.toFixed(1)};desc="current-state read";queries=${input.queryCount}`;
}

export interface OperationsPerformanceApi {
  mark(name: string): void;
  measure(name: string, startMark: string, endMark: string): void;
}

export interface OperationsMarkApi {
  mark(name: string): void;
  getEntriesByName(name: string): ArrayLike<unknown>;
}

export const OPERATIONS_DECISION_SURFACE_READY_MARK =
  "dpf.operations.decision-surface.ready";

export function markOperationsDecisionSurfaceReady(
  performanceApi: OperationsMarkApi,
): void {
  if (performanceApi.getEntriesByName(OPERATIONS_DECISION_SURFACE_READY_MARK).length > 0) {
    return;
  }
  performanceApi.mark(OPERATIONS_DECISION_SURFACE_READY_MARK);
}

export function createOperationsInteractionMeasure(
  performanceApi: OperationsPerformanceApi,
  commandKind: string,
  interactionId: string,
): (outcome: string) => void {
  const prefix = `dpf.operations.${commandKind}.${interactionId}`;
  const startMark = `${prefix}.start`;
  performanceApi.mark(startMark);
  return (outcome) => {
    const endMark = `${prefix}.${outcome}`;
    performanceApi.mark(endMark);
    performanceApi.measure(`dpf.operations.${commandKind}.${outcome}`, startMark, endMark);
  };
}
