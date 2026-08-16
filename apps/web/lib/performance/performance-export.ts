import type { ReadyBusinessPerformance } from "./business-performance-provider";

/** Aggregate-only export projection. No source-row identifiers cross this boundary. */
export function buildPerformanceExportRows(performance: ReadyBusinessPerformance) {
  return performance.metricValues.map((metric) => ({
    period: performance.periodLabel,
    metric: metric.label,
    value: metric.value,
    unit: metric.unit,
    availability: metric.availability,
    unavailable_reason: metric.unavailableReason ?? "",
    prior_period_value: metric.comparisonValue,
    definition_version: metric.definitionVersion ?? "",
    source_watermark: metric.sourceWatermark?.toISOString() ?? "",
  }));
}
