import type { BusinessPerformanceMetricValue } from "./business-performance-provider";
import { formatComparisonMagnitude } from "./performance-format";

export interface PerformanceObservedChange {
  key: string;
  label: string;
  delta: number;
  direction: "increased" | "decreased" | "unchanged";
}

export interface PerformanceReviewItem {
  key: string;
  label: string;
  reason: string;
  kind: "missing-headline" | "observed-change";
}

export interface PerformanceDecisionSummary {
  observedChanges: readonly PerformanceObservedChange[];
  reviewItems: readonly PerformanceReviewItem[];
  driverEvidence: {
    status: "not-available";
    message: string;
  };
}

function direction(delta: number): PerformanceObservedChange["direction"] {
  if (delta > 0) return "increased";
  if (delta < 0) return "decreased";
  return "unchanged";
}

/**
 * Projects owner-facing observations from governed metric facts. The read model
 * does not yet carry targets or causal-driver evidence, so this helper keeps
 * movement neutral and makes the evidence boundary explicit.
 */
export function buildPerformanceDecisionSummary(input: {
  metrics: readonly BusinessPerformanceMetricValue[];
  headlineKeys: readonly string[];
}): PerformanceDecisionSummary {
  const headline = new Set(input.headlineKeys);
  const observedChanges = input.metrics
    .filter((metric): metric is BusinessPerformanceMetricValue & { comparisonDelta: number } =>
      metric.comparisonDelta !== null)
    .map((metric) => ({
      key: metric.key,
      label: metric.label,
      delta: metric.comparisonDelta,
      direction: direction(metric.comparisonDelta),
    }))
    .sort((left, right) => Math.abs(right.delta) - Math.abs(left.delta));

  const missingHeadline: PerformanceReviewItem[] = input.metrics
    .filter((metric) => headline.has(metric.key) && metric.availability === "unavailable")
    .map((metric) => ({
      key: metric.key,
      label: metric.label,
      reason: metric.unavailableReason ?? "No snapshot is available for this headline metric.",
      kind: "missing-headline",
    }));
  const changedHeadline: PerformanceReviewItem[] = observedChanges
    .filter((change) => headline.has(change.key))
    .map((change) => ({
      key: change.key,
      label: change.label,
      reason: `Moved ${formatComparisonMagnitude(change.delta)} versus the prior period; review context before acting.`,
      kind: "observed-change",
    }));

  return {
    observedChanges,
    reviewItems: [...missingHeadline, ...changedHeadline].slice(0, 3),
    driverEvidence: {
      status: "not-available",
      message: "Connected sources explain where each number came from, but they do not yet prove what caused the change.",
    },
  };
}
