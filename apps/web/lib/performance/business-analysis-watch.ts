import {
  PERFORMANCE_MATERIALITY_DIRECTIONS,
  PERFORMANCE_MATERIALITY_MODES,
  getPerformanceMetricDefinition,
  validateBusinessAnalysisPlan,
  type NormalizedBusinessAnalysisPlan,
  type PerformanceMaterialityDirection,
  type PerformanceMaterialityMode,
} from "@dpf/storefront-templates";

import { isRecord } from "@/lib/shared/coerce";

export type BusinessAnalysisWatchMateriality = {
  mode: PerformanceMaterialityMode;
  direction: PerformanceMaterialityDirection;
  value: number;
};

export type BusinessAnalysisWatchEvaluationStatus =
  | "material-change"
  | "unchanged"
  | "stale-source"
  | "metric-unavailable";

export type BusinessAnalysisWatchEvaluation = {
  status: BusinessAnalysisWatchEvaluationStatus;
  fingerprint: string;
  metricKey: string;
  baselineValue: number;
  currentValue: number | null;
  delta: number | null;
  evaluatedAt: string;
  sourceWatermark: string | null;
};

export type BusinessAnalysisWatchConfig = {
  schemaVersion: 1;
  plan: NormalizedBusinessAnalysisPlan;
  fingerprint: string;
  materiality: BusinessAnalysisWatchMateriality;
  baseline: { value: number; sourceWatermark: string };
  lastEvaluation: BusinessAnalysisWatchEvaluation | null;
};

const isOneOf = <T extends string>(value: unknown, values: readonly T[]): value is T =>
  typeof value === "string" && values.includes(value as T);

function validIsoInstant(value: unknown): value is string {
  return typeof value === "string" && !Number.isNaN(new Date(value).getTime());
}

function isoDurationMs(value: string): number {
  const match = /^P(?:(\d+)D)?(?:T(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?)?$/.exec(value);
  if (!match) throw new Error("Watch freshness limit must be an ISO 8601 duration.");
  const [, days = "0", hours = "0", minutes = "0", seconds = "0"] = match;
  return (
    Number(days) * 86_400_000 +
    Number(hours) * 3_600_000 +
    Number(minutes) * 60_000 +
    Number(seconds) * 1_000
  );
}

export function parseBusinessAnalysisWatchConfig(
  value: unknown,
): BusinessAnalysisWatchConfig {
  if (!isRecord(value) || value.schemaVersion !== 1) {
    throw new Error("Business analysis watch configuration is missing or unsupported.");
  }
  const planResult = validateBusinessAnalysisPlan(value.plan);
  if (planResult.status !== "accepted") {
    throw new Error("Business analysis watch requires an accepted plan.");
  }
  if (value.fingerprint !== planResult.fingerprint) {
    throw new Error("Business analysis watch fingerprint does not match its accepted plan.");
  }
  if (planResult.plan.metrics.length !== 1) {
    throw new Error("Business analysis watches currently require exactly one metric.");
  }
  const materiality = value.materiality;
  if (!isRecord(materiality) || !isOneOf(materiality.mode, PERFORMANCE_MATERIALITY_MODES)) {
    throw new Error("Business analysis watch materiality mode is unsupported.");
  }
  if (!isOneOf(materiality.direction, PERFORMANCE_MATERIALITY_DIRECTIONS)) {
    throw new Error("Business analysis watch materiality direction is unsupported.");
  }
  if (typeof materiality.value !== "number" || !Number.isFinite(materiality.value) || materiality.value <= 0) {
    throw new Error("Business analysis watch materiality value must be a positive number.");
  }
  const metricKey = planResult.plan.metrics[0]!.key;
  const capability = getPerformanceMetricDefinition(metricKey)?.materiality;
  if (!capability?.modes.includes(materiality.mode)
    || !capability.directions.includes(materiality.direction)) {
    throw new Error("The selected metric does not support this materiality boundary.");
  }
  const baseline = value.baseline;
  if (!isRecord(baseline)
    || typeof baseline.value !== "number"
    || !Number.isFinite(baseline.value)
    || !validIsoInstant(baseline.sourceWatermark)) {
    throw new Error("Business analysis watch requires a valid baseline and watermark.");
  }
  return {
    schemaVersion: 1,
    plan: planResult.plan,
    fingerprint: planResult.fingerprint,
    materiality: {
      mode: materiality.mode,
      direction: materiality.direction,
      value: materiality.value,
    },
    baseline: {
      value: baseline.value,
      sourceWatermark: new Date(baseline.sourceWatermark).toISOString(),
    },
    lastEvaluation: isRecord(value.lastEvaluation)
      ? value.lastEvaluation as BusinessAnalysisWatchEvaluation
      : null,
  };
}

function crossesDirection(
  delta: number,
  threshold: number,
  direction: PerformanceMaterialityDirection,
): boolean {
  if (direction === "increase") return delta >= threshold;
  if (direction === "decrease") return delta <= -threshold;
  return Math.abs(delta) >= threshold;
}

export function evaluateBusinessAnalysisWatch(
  input: unknown,
  observation: {
    evaluatedAt: Date;
    metric: {
      key: string;
      availability: "available" | "unavailable";
      value: number | null;
      sourceWatermark: Date | null;
    };
  },
): { evaluation: BusinessAnalysisWatchEvaluation; nextConfig: BusinessAnalysisWatchConfig } {
  const config = parseBusinessAnalysisWatchConfig(input);
  const metricKey = config.plan.metrics[0]!.key;
  if (observation.metric.key !== metricKey) {
    throw new Error("Observed metric does not match the accepted plan.");
  }
  const source = config.plan.sources.find(
    ({ owner }) => owner === getPerformanceMetricDefinition(metricKey)?.sourceOwner,
  )!;
  const sourceWatermark = observation.metric.sourceWatermark;
  let status: BusinessAnalysisWatchEvaluationStatus = "unchanged";
  let delta: number | null = null;
  if (observation.metric.availability !== "available" || observation.metric.value === null) {
    status = "metric-unavailable";
  } else if (!sourceWatermark
    || observation.evaluatedAt.getTime() - sourceWatermark.getTime() > isoDurationMs(source.maximumAge)) {
    status = "stale-source";
  } else {
    const rawDelta = observation.metric.value - config.baseline.value;
    delta = config.materiality.mode === "relative"
      ? config.baseline.value === 0 ? null : rawDelta / Math.abs(config.baseline.value)
      : rawDelta;
    if (delta !== null && crossesDirection(delta, config.materiality.value, config.materiality.direction)) {
      status = "material-change";
    }
  }
  const evaluation: BusinessAnalysisWatchEvaluation = {
    status,
    fingerprint: config.fingerprint,
    metricKey,
    baselineValue: config.baseline.value,
    currentValue: observation.metric.value,
    delta,
    evaluatedAt: observation.evaluatedAt.toISOString(),
    sourceWatermark: sourceWatermark?.toISOString() ?? null,
  };
  return {
    evaluation,
    nextConfig: {
      ...config,
      baseline: status === "material-change" && observation.metric.value !== null && sourceWatermark
        ? { value: observation.metric.value, sourceWatermark: sourceWatermark.toISOString() }
        : config.baseline,
      lastEvaluation: evaluation,
    },
  };
}
