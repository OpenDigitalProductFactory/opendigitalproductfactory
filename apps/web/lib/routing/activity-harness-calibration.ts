import type { HarnessRecipeConfidence } from "./harness-recipe";

export type ActivityHarnessSuccessSignal =
  | "unknown"
  | "valid"
  | "accepted"
  | "review-passed"
  | "failed"
  | "retried"
  | "attention";

export type ActivityHarnessOutcomeSample = {
  activityClass: string;
  harnessRecipeKey: string;
  confidence: HarnessRecipeConfidence;
  providerId: string;
  modelId: string | null;
  successSignal: ActivityHarnessSuccessSignal;
  evidenceStrength: "route-only" | "linked";
  tokenTotal: number | null;
  costUsd: number | null;
  qualitySignal: number | null;
};

export type ActivityHarnessCalibrationRecommendation =
  | "observe"
  | "keep"
  | "promote"
  | "degrade";

export type ActivityHarnessCalibration = {
  calibrationKey: string;
  activityClass: string;
  harnessRecipeKey: string;
  providerId: string;
  modelId: string | null;
  currentConfidence: HarnessRecipeConfidence;
  recommendedConfidence: HarnessRecipeConfidence;
  recommendation: ActivityHarnessCalibrationRecommendation;
  sampleCount: number;
  linkedSampleCount: number;
  successRate: number;
  failureRate: number;
  retryRate: number;
  avgCostUsd: number | null;
  avgTokenTotal: number | null;
  avgQualitySignal: number | null;
  rationale: string;
};

const MIN_SAMPLES_FOR_DECISION = 5;
const MIN_LINKED_SAMPLES_FOR_PROMOTION = 10;
const PROMOTION_SUCCESS_RATE = 0.9;
const PROMOTION_QUALITY_FLOOR = 0.8;
const DEGRADE_FAILURE_RATE = 0.25;
const DEGRADE_RETRY_RATE = 0.35;

export function calibrateActivityHarnesses(
  samples: ActivityHarnessOutcomeSample[],
): ActivityHarnessCalibration[] {
  const groups = new Map<string, ActivityHarnessOutcomeSample[]>();
  for (const sample of samples) {
    const key = calibrationKey(sample);
    const group = groups.get(key) ?? [];
    group.push(sample);
    groups.set(key, group);
  }

  return [...groups.entries()]
    .map(([key, group]) => calibrationForGroup(key, group))
    .sort((left, right) => left.calibrationKey.localeCompare(right.calibrationKey));
}

function calibrationForGroup(
  key: string,
  group: ActivityHarnessOutcomeSample[],
): ActivityHarnessCalibration {
  const first = group[0]!;
  const successCount = group.filter((sample) => isSuccess(sample.successSignal)).length;
  const failureCount = group.filter((sample) => sample.successSignal === "failed").length;
  const retryCount = group.filter((sample) => sample.successSignal === "retried").length;
  const linkedSampleCount = group.filter((sample) => sample.evidenceStrength === "linked").length;
  const sampleCount = group.length;
  const successRate = successCount / sampleCount;
  const failureRate = failureCount / sampleCount;
  const retryRate = retryCount / sampleCount;
  const avgQualitySignal = average(group.map((sample) => sample.qualitySignal));
  const recommendation = recommend({
    currentConfidence: first.confidence,
    sampleCount,
    linkedSampleCount,
    successRate,
    failureRate,
    retryRate,
    avgQualitySignal,
  });

  return {
    calibrationKey: key,
    activityClass: first.activityClass,
    harnessRecipeKey: first.harnessRecipeKey,
    providerId: first.providerId,
    modelId: first.modelId,
    currentConfidence: first.confidence,
    recommendedConfidence: recommendedConfidence(first.confidence, recommendation),
    recommendation,
    sampleCount,
    linkedSampleCount,
    successRate,
    failureRate,
    retryRate,
    avgCostUsd: average(group.map((sample) => sample.costUsd)),
    avgTokenTotal: average(group.map((sample) => sample.tokenTotal)),
    avgQualitySignal,
    rationale: rationaleForRecommendation(recommendation, {
      sampleCount,
      linkedSampleCount,
      successRate,
      failureRate,
      retryRate,
      avgQualitySignal,
    }),
  };
}

function recommend(input: {
  currentConfidence: HarnessRecipeConfidence;
  sampleCount: number;
  linkedSampleCount: number;
  successRate: number;
  failureRate: number;
  retryRate: number;
  avgQualitySignal: number | null;
}): ActivityHarnessCalibrationRecommendation {
  if (input.failureRate >= DEGRADE_FAILURE_RATE || input.retryRate >= DEGRADE_RETRY_RATE) {
    return "degrade";
  }
  if (input.sampleCount < MIN_SAMPLES_FOR_DECISION) {
    return "observe";
  }
  if (
    input.currentConfidence !== "trusted" &&
    input.linkedSampleCount >= MIN_LINKED_SAMPLES_FOR_PROMOTION &&
    input.successRate >= PROMOTION_SUCCESS_RATE &&
    input.failureRate === 0 &&
    (input.avgQualitySignal === null || input.avgQualitySignal >= PROMOTION_QUALITY_FLOOR)
  ) {
    return "promote";
  }
  return "keep";
}

function recommendedConfidence(
  current: HarnessRecipeConfidence,
  recommendation: ActivityHarnessCalibrationRecommendation,
): HarnessRecipeConfidence {
  if (recommendation === "promote") return "trusted";
  if (recommendation === "degrade") return "degraded";
  return current;
}

function rationaleForRecommendation(
  recommendation: ActivityHarnessCalibrationRecommendation,
  stats: {
    sampleCount: number;
    linkedSampleCount: number;
    successRate: number;
    failureRate: number;
    retryRate: number;
    avgQualitySignal: number | null;
  },
): string {
  if (recommendation === "observe") {
    return `Only ${stats.sampleCount} sample(s) are available; keep collecting linked outcome evidence.`;
  }
  if (recommendation === "promote") {
    return `${stats.linkedSampleCount} linked sample(s) with ${(stats.successRate * 100).toFixed(0)}% success support trust graduation.`;
  }
  if (recommendation === "degrade") {
    return `Failure/retry rates are elevated: ${(stats.failureRate * 100).toFixed(0)}% failed, ${(stats.retryRate * 100).toFixed(0)}% retried.`;
  }
  if (stats.avgQualitySignal !== null && stats.avgQualitySignal < PROMOTION_QUALITY_FLOOR) {
    return `Average evaluator quality ${(stats.avgQualitySignal * 100).toFixed(0)}% is below the trust floor.`;
  }
  return `${stats.sampleCount} sample(s) do not justify a confidence change yet.`;
}

function calibrationKey(sample: ActivityHarnessOutcomeSample): string {
  return [
    sample.activityClass,
    sample.harnessRecipeKey,
    sample.providerId,
    sample.modelId ?? "unknown-model",
  ].join("|");
}

function isSuccess(signal: ActivityHarnessSuccessSignal): boolean {
  return signal === "valid" || signal === "accepted" || signal === "review-passed";
}

function average(values: Array<number | null>): number | null {
  const numeric = values.filter((value): value is number => typeof value === "number");
  if (numeric.length === 0) return null;
  const raw = numeric.reduce((sum, value) => sum + value, 0) / numeric.length;
  return Math.round(raw * 1_000_000) / 1_000_000;
}
