import type { z } from "zod";

export type AutonomousReviewFailureReason =
  | "timeout"
  | "json_parse"
  | "schema_validation"
  | "provider_rate_limit"
  | "provider_unavailable"
  | "router_no_route"
  | "budget_exhausted"
  | "unknown";

export type AutonomousReviewSkipReason = "operator_disabled" | "auto_paused" | "no_candidates";

export type AutonomousReviewerHealthStatus =
  | "healthy"
  | "auto_pause_parse_rate"
  | "auto_pause_unknown_failures"
  | "auto_pause_degenerate_distribution";

export type AutonomousReviewSettings = {
  enabled: boolean;
  cacheTtlDays: number;
  minParseRate: number;
  maxUnknownFailuresInWindow: number;
  maxSingleClassFraction: number;
  healthWindowSize: number;
};

type PlatformConfigClient = {
  findUnique: (args: {
    where: { key: string };
    select?: { value?: boolean };
  }) => Promise<{ value: unknown } | null>;
};

type TaskRunClient = {
  findMany: (args: unknown) => Promise<Array<{ progressPayload: unknown }>>;
};

const DEFAULT_SETTINGS: AutonomousReviewSettings = {
  enabled: true,
  cacheTtlDays: 30,
  minParseRate: 0.5,
  maxUnknownFailuresInWindow: 1,
  maxSingleClassFraction: 0.9,
  healthWindowSize: 5,
};

export function classifyAutonomousReviewFailure(error: unknown): AutonomousReviewFailureReason {
  const message = error instanceof Error ? error.message.toLowerCase() : String(error).toLowerCase();
  if (message.includes("timeout") || message.includes("timed out")) return "timeout";
  if (message.includes("rate") && message.includes("limit")) return "provider_rate_limit";
  if (message.includes("unavailable") || message.includes("503")) return "provider_unavailable";
  if (message.includes("no route") || message.includes("router")) return "router_no_route";
  if (message.includes("budget")) return "budget_exhausted";
  if (message.includes("json") || message.includes("parse")) return "json_parse";
  if (message.includes("schema") || message.includes("validation")) return "schema_validation";
  return "unknown";
}

export function validateAutonomousReviewDecisions<T>(
  schema: z.ZodType<T>,
  values: unknown[],
): {
  decisions: T[];
  dropped: number;
  parseSuccessRate: (batchSize: number) => number;
} {
  const decisions: T[] = [];
  let dropped = 0;

  for (const value of values) {
    const parsed = schema.safeParse(value);
    if (parsed.success) {
      decisions.push(parsed.data);
    } else {
      dropped++;
    }
  }

  return {
    decisions,
    dropped,
    parseSuccessRate: (batchSize: number) => (batchSize > 0 ? decisions.length / batchSize : 1),
  };
}

export function assertReviewInputAllowlist(
  input: Record<string, unknown>,
  allowedKeys: readonly string[],
): void {
  const allowed = new Set(allowedKeys);
  const unexpected = Object.keys(input).filter((key) => !allowed.has(key));
  if (unexpected.length > 0) {
    throw new Error(`Review input contains non-allowlisted field(s): ${unexpected.join(", ")}`);
  }
}

function parseSettingBoolean(value: unknown, fallback: boolean): boolean {
  if (typeof value === "boolean") return value;
  if (typeof value === "string") {
    if (value.toLowerCase() === "false") return false;
    if (value.toLowerCase() === "true") return true;
  }
  return fallback;
}

function parseSettingNumber(value: unknown, fallback: number): number {
  if (typeof value === "number" && Number.isFinite(value) && value > 0) return value;
  if (typeof value === "string") {
    const parsed = Number(value);
    if (Number.isFinite(parsed) && parsed > 0) return parsed;
  }
  return fallback;
}

export async function loadAutonomousReviewSettings(input: {
  settingPrefix: string;
  platformConfig?: PlatformConfigClient | null;
  defaults?: Partial<AutonomousReviewSettings>;
}): Promise<AutonomousReviewSettings> {
  const defaults = { ...DEFAULT_SETTINGS, ...input.defaults };
  if (!input.platformConfig) return defaults;

  const key = (suffix: string) => `${input.settingPrefix}.${suffix}`;
  const [enabledRow, ttlRow, minParseRateRow, maxUnknownRow, maxSingleClassRow, windowSizeRow] = await Promise.all([
    input.platformConfig.findUnique({ where: { key: key("enabled") }, select: { value: true } }),
    input.platformConfig.findUnique({ where: { key: key("cacheTtlDays") }, select: { value: true } }),
    input.platformConfig.findUnique({ where: { key: key("minParseRate") }, select: { value: true } }),
    input.platformConfig.findUnique({ where: { key: key("maxUnknownFailuresInWindow") }, select: { value: true } }),
    input.platformConfig.findUnique({ where: { key: key("maxSingleClassFraction") }, select: { value: true } }),
    input.platformConfig.findUnique({ where: { key: key("healthWindowSize") }, select: { value: true } }),
  ]);

  return {
    enabled: parseSettingBoolean(enabledRow?.value, defaults.enabled),
    cacheTtlDays: parseSettingNumber(ttlRow?.value, defaults.cacheTtlDays),
    minParseRate: parseSettingNumber(minParseRateRow?.value, defaults.minParseRate),
    maxUnknownFailuresInWindow: parseSettingNumber(
      maxUnknownRow?.value,
      defaults.maxUnknownFailuresInWindow,
    ),
    maxSingleClassFraction: parseSettingNumber(maxSingleClassRow?.value, defaults.maxSingleClassFraction),
    healthWindowSize: Math.max(1, Math.floor(parseSettingNumber(windowSizeRow?.value, defaults.healthWindowSize))),
  };
}

function readRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function readScheduledReviewMetrics(progressPayload: unknown): Record<string, unknown> | null {
  const progress = readRecord(progressPayload);
  const summaryPayload = readRecord(progress?.scheduledSummaryPayload);
  return readRecord(summaryPayload?.metrics);
}

function singleClassFraction(histogram: unknown): number {
  const record = readRecord(histogram);
  if (!record) return 0;
  const counts = Object.values(record)
    .map((value) => (typeof value === "number" && Number.isFinite(value) ? value : 0))
    .filter((value) => value > 0);
  const total = counts.reduce((sum, value) => sum + value, 0);
  if (total === 0) return 0;
  return Math.max(...counts) / total;
}

export async function evaluateAutonomousReviewerHealth(input: {
  agentId: string;
  taskRun?: TaskRunClient | null;
  thresholds?: Partial<Pick<
    AutonomousReviewSettings,
    "minParseRate" | "maxUnknownFailuresInWindow" | "maxSingleClassFraction" | "healthWindowSize"
  >>;
}): Promise<AutonomousReviewerHealthStatus> {
  if (!input.taskRun) return "healthy";

  const thresholds = { ...DEFAULT_SETTINGS, ...input.thresholds };
  const runs = await input.taskRun.findMany({
    where: {
      currentAgentId: input.agentId,
      progressPayload: { not: null },
    },
    orderBy: { createdAt: "desc" },
    take: thresholds.healthWindowSize,
    select: { progressPayload: true },
  });

  let parseRateTotal = 0;
  let parseRateCount = 0;
  let unknownFailures = 0;
  let degenerateDistribution = false;

  for (const run of runs) {
    const metrics = readScheduledReviewMetrics(run.progressPayload);
    if (!metrics) continue;

    const parseRate = metrics.reviewParseSuccessRate;
    if (typeof parseRate === "number" && Number.isFinite(parseRate)) {
      parseRateTotal += parseRate;
      parseRateCount++;
    }
    if (metrics.reviewFailureReason === "unknown") unknownFailures++;
    if (singleClassFraction(metrics.reviewClassificationHistogram) >= thresholds.maxSingleClassFraction) {
      degenerateDistribution = true;
    }
  }

  if (parseRateCount > 0 && parseRateTotal / parseRateCount < thresholds.minParseRate) {
    return "auto_pause_parse_rate";
  }
  if (unknownFailures > thresholds.maxUnknownFailuresInWindow) {
    return "auto_pause_unknown_failures";
  }
  if (degenerateDistribution) {
    return "auto_pause_degenerate_distribution";
  }
  return "healthy";
}
