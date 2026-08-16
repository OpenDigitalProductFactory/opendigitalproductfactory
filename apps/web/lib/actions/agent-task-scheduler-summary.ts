import { isRecord } from "@/lib/shared/coerce";
import type { AgenticResult } from "@/lib/tak/agentic-loop";

type DiscoveryTriageSummaryPayload = {
  trigger: "cadence" | "volume";
  processedAt: string;
  runIdempotencyKey?: string;
  skipped?: boolean;
  skipReason?: string | null;
  metrics?: {
    processed?: number;
    decisionsCreated?: number;
    autoAttributed?: number;
    humanReview?: number;
    taxonomyGap?: number;
    needsMoreEvidence?: number;
    dismissed?: number;
    escalationQueueDepth?: number;
    repeatUnresolved?: number;
    autoApplyRate?: number;
    reviewed?: number;
    reviewFailed?: number;
    reviewBatchSize?: number;
    reviewBatchUtilization?: number;
    reviewParseSuccessRate?: number;
    reviewSchemaDropCount?: number;
    reviewLatencyMs?: number | null;
    reviewFailureReason?: string;
    reviewSkipReason?: string;
    autoPauseTrigger?: string | null;
    reviewClassificationHistogram?: Record<string, number>;
  };
};

export type ScheduledTaskSummary = {
  compactStatus: string;
  threadMessage: string;
  payload?: DiscoveryTriageSummaryPayload | HiveScoutSummaryPayload;
};

type HiveScoutSummaryPayload = {
  processedAt: string;
  metrics: {
    catalogEntries: number;
    gaps: number;
    reviewed: number;
    created: number;
    duplicates: number;
    skippedByReview: number;
    needsReview: number;
    reviewFailed: number;
    reviewBatchSize: number;
    reviewBatchUtilization: number;
    reviewParseSuccessRate: number;
    reviewSchemaDropCount: number;
    reviewCacheHits: number;
    reviewCacheHitRate: number;
    reviewLatencyMs: number;
    reviewFailureReason?: string;
    reviewSkipReason?: string;
    reviewClassificationHistogram?: Record<string, number>;
    reviewClassificationByFramework?: Record<string, Record<string, number>>;
    reviewClassificationByIndustry?: Record<string, Record<string, number>>;
    marketSourcesAttempted?: number;
    marketSourcesFetched?: number;
    marketSourcesChanged?: number;
    marketSourcesFailed?: number;
  };
  createdItemIds?: string[];
};

function asNumber(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function asString(value: unknown): string | null {
  return typeof value === "string" && value.trim().length > 0 ? value : null;
}

function asBoolean(value: unknown): boolean | null {
  return typeof value === "boolean" ? value : null;
}

function unwrapToolData(value: unknown): Record<string, unknown> | null {
  if (!isRecord(value)) return null;
  if (isRecord(value.metrics)) return value;
  return isRecord(value.data) ? value.data : value;
}

function asPositiveNumberRecord(value: unknown): Record<string, number> | null {
  if (!isRecord(value)) return null;
  const entries = Object.entries(value)
    .map(([key, entryValue]): [string, number] => [key, asNumber(entryValue) ?? 0])
    .filter(([, entryValue]) => entryValue > 0);
  return entries.length > 0 ? Object.fromEntries(entries) : null;
}

function asPositiveNestedNumberRecord(value: unknown): Record<string, Record<string, number>> | null {
  if (!isRecord(value)) return null;
  const groups = Object.entries(value)
    .map(([group, bucket]): [string, Record<string, number> | null] => [
      group,
      asPositiveNumberRecord(bucket),
    ])
    .filter((entry): entry is [string, Record<string, number>] => Boolean(entry[1]));
  return groups.length > 0 ? Object.fromEntries(groups) : null;
}

export function extractDiscoveryTriageSummary(
  executedTools: AgenticResult["executedTools"],
): ScheduledTaskSummary | null {
  const triageTool = [...executedTools]
    .reverse()
    .find((entry) => entry.name === "run_discovery_triage" && entry.result.success && Boolean(unwrapToolData(entry.result.data)));

  const triageData = unwrapToolData(triageTool?.result.data);
  if (!triageData) {
    return null;
  }

  const trigger = triageData.trigger === "volume" ? "volume" : "cadence";
  const processedAt = asString(triageData.processedAt) ?? new Date().toISOString();
  const runIdempotencyKey = asString(triageData.runIdempotencyKey);
  const skipped = asBoolean(triageData.skipped) ?? false;
  const skipReason = asString(triageData.skipReason);
  const metrics = isRecord(triageData.metrics) ? triageData.metrics : {};

  const payload: DiscoveryTriageSummaryPayload = {
    trigger,
    processedAt,
    ...(runIdempotencyKey ? { runIdempotencyKey } : {}),
    ...(skipped ? { skipped } : {}),
    ...(skipReason ? { skipReason } : {}),
    metrics: {
      processed: asNumber(metrics.processed) ?? 0,
      decisionsCreated: asNumber(metrics.decisionsCreated) ?? 0,
      autoAttributed: asNumber(metrics.autoAttributed) ?? 0,
      humanReview: asNumber(metrics.humanReview) ?? 0,
      taxonomyGap: asNumber(metrics.taxonomyGap) ?? 0,
      needsMoreEvidence: asNumber(metrics.needsMoreEvidence) ?? 0,
      dismissed: asNumber(metrics.dismissed) ?? 0,
      escalationQueueDepth: asNumber(metrics.escalationQueueDepth) ?? 0,
      repeatUnresolved: asNumber(metrics.repeatUnresolved) ?? 0,
      autoApplyRate: asNumber(metrics.autoApplyRate) ?? 0,
      reviewed: asNumber(metrics.reviewed) ?? 0,
      reviewFailed: asNumber(metrics.reviewFailed) ?? 0,
      reviewBatchSize: asNumber(metrics.reviewBatchSize) ?? 0,
      reviewBatchUtilization: asNumber(metrics.reviewBatchUtilization) ?? 0,
      reviewParseSuccessRate: asNumber(metrics.reviewParseSuccessRate) ?? 0,
      reviewSchemaDropCount: asNumber(metrics.reviewSchemaDropCount) ?? 0,
      reviewLatencyMs: asNumber(metrics.reviewLatencyMs) ?? 0,
      ...(asString(metrics.reviewFailureReason)
        ? { reviewFailureReason: asString(metrics.reviewFailureReason) as string }
        : {}),
      ...(asString(metrics.reviewSkipReason)
        ? { reviewSkipReason: asString(metrics.reviewSkipReason) as string }
        : {}),
      ...(asString(metrics.autoPauseTrigger)
        ? { autoPauseTrigger: asString(metrics.autoPauseTrigger) as string }
        : {}),
      ...(isRecord(metrics.reviewClassificationHistogram)
        ? {
            reviewClassificationHistogram: Object.fromEntries(
              Object.entries(metrics.reviewClassificationHistogram)
                .map(([key, value]): [string, number] => [key, asNumber(value) ?? 0])
                .filter(([, value]) => value > 0),
            ),
          }
        : {}),
    },
  };

  const compactStatus = skipped
    ? `Discovery triage skipped (${trigger})${runIdempotencyKey ? ` [${runIdempotencyKey}]` : ""}`
    : [
        `Discovery triage ${trigger}`,
        `processed=${payload.metrics?.processed ?? 0}`,
        `auto=${payload.metrics?.autoAttributed ?? 0}`,
        `escalations=${payload.metrics?.escalationQueueDepth ?? 0}`,
        `taxonomy-gaps=${payload.metrics?.taxonomyGap ?? 0}`,
        `reviewed=${payload.metrics?.reviewed ?? 0}`,
        `review-schema-drops=${payload.metrics?.reviewSchemaDropCount ?? 0}`,
      ].join(" ");

  const threadMessage = [
    "[Scheduled summary: discovery taxonomy gap triage]",
    "",
    skipped
      ? `Run skipped: ${skipReason ?? "duplicate run detected."}`
      : `Run completed for trigger \`${trigger}\`.`,
    "",
    "```json",
    JSON.stringify(payload, null, 2),
    "```",
  ].join("\n");

  return {
    compactStatus,
    threadMessage,
    payload,
  };
}

export function extractHiveScoutSummary(
  executedTools: AgenticResult["executedTools"],
): ScheduledTaskSummary | null {
  const scoutTool = [...executedTools]
    .reverse()
    .find((entry) => entry.name === "run_hive_scout_ingest" && entry.result.success && isRecord(entry.result.data));

  if (!scoutTool || !isRecord(scoutTool.result.data)) {
    return null;
  }

  const createdItemIds = Array.isArray(scoutTool.result.data.createdItemIds)
    ? scoutTool.result.data.createdItemIds.filter((item): item is string => typeof item === "string" && item.length > 0)
    : [];
  const reviewClassificationHistogram = asPositiveNumberRecord(
    scoutTool.result.data.reviewClassificationHistogram,
  );
  const reviewClassificationByFramework = asPositiveNestedNumberRecord(
    scoutTool.result.data.reviewClassificationByFramework,
  );
  const reviewClassificationByIndustry = asPositiveNestedNumberRecord(
    scoutTool.result.data.reviewClassificationByIndustry,
  );

  // Market-aperture pass metrics (BI-B8E4317D) — absent on runs predating it.
  const marketRaw = isRecord(scoutTool.result.data.marketSources)
    ? scoutTool.result.data.marketSources
    : null;
  const marketMetrics = marketRaw
    ? {
        marketSourcesAttempted: asNumber(marketRaw.attempted) ?? 0,
        marketSourcesFetched: asNumber(marketRaw.fetched) ?? 0,
        marketSourcesChanged: asNumber(marketRaw.changed) ?? 0,
        marketSourcesFailed: asNumber(marketRaw.failed) ?? 0,
      }
    : null;

  const payload: HiveScoutSummaryPayload = {
    processedAt: new Date().toISOString(),
    metrics: {
      catalogEntries: asNumber(scoutTool.result.data.catalogEntries) ?? 0,
      gaps: asNumber(scoutTool.result.data.gaps) ?? 0,
      reviewed: asNumber(scoutTool.result.data.reviewed) ?? 0,
      created: asNumber(scoutTool.result.data.created) ?? 0,
      duplicates: asNumber(scoutTool.result.data.duplicates) ?? 0,
      skippedByReview: asNumber(scoutTool.result.data.skippedByReview) ?? 0,
      needsReview: asNumber(scoutTool.result.data.needsReview)
        ?? asNumber(scoutTool.result.data.deferred)
        ?? 0,
      reviewFailed: asNumber(scoutTool.result.data.reviewFailed) ?? 0,
      reviewBatchSize: asNumber(scoutTool.result.data.reviewBatchSize) ?? 0,
      reviewBatchUtilization: asNumber(scoutTool.result.data.reviewBatchUtilization) ?? 0,
      reviewParseSuccessRate: asNumber(scoutTool.result.data.reviewParseSuccessRate) ?? 0,
      reviewSchemaDropCount: asNumber(scoutTool.result.data.reviewSchemaDropCount) ?? 0,
      reviewCacheHits: asNumber(scoutTool.result.data.reviewCacheHits) ?? 0,
      reviewCacheHitRate: asNumber(scoutTool.result.data.reviewCacheHitRate) ?? 0,
      reviewLatencyMs: asNumber(scoutTool.result.data.reviewLatencyMs) ?? 0,
      ...(asString(scoutTool.result.data.reviewFailureReason)
        ? { reviewFailureReason: asString(scoutTool.result.data.reviewFailureReason) as string }
        : {}),
      ...(asString(scoutTool.result.data.reviewSkipReason)
        ? { reviewSkipReason: asString(scoutTool.result.data.reviewSkipReason) as string }
        : {}),
      ...(reviewClassificationHistogram ? { reviewClassificationHistogram } : {}),
      ...(reviewClassificationByFramework ? { reviewClassificationByFramework } : {}),
      ...(reviewClassificationByIndustry ? { reviewClassificationByIndustry } : {}),
      ...(marketMetrics ?? {}),
    },
    ...(createdItemIds.length > 0 ? { createdItemIds } : {}),
  };

  const compactStatus = [
    "Hive Scout",
    `parsed=${payload.metrics.catalogEntries}`,
    `gaps=${payload.metrics.gaps}`,
    `reviewed=${payload.metrics.reviewed}`,
    `created=${payload.metrics.created}`,
    `duplicates=${payload.metrics.duplicates}`,
    `review-rejections=${payload.metrics.skippedByReview}`,
    `review-schema-drops=${payload.metrics.reviewSchemaDropCount}`,
    `review-cache-hits=${payload.metrics.reviewCacheHits}`,
    `needs-review=${payload.metrics.needsReview}`,
    ...(marketMetrics
      ? [
          `market-fetched=${marketMetrics.marketSourcesFetched}/${marketMetrics.marketSourcesAttempted}`,
          `market-changed=${marketMetrics.marketSourcesChanged}`,
          `market-failed=${marketMetrics.marketSourcesFailed}`,
        ]
      : []),
  ].join(" ");

  const threadMessage = [
    "[Scheduled summary: Hive Scout external catalog pass]",
    "",
    "Run completed against the approved external catalog source.",
    "",
    "```json",
    JSON.stringify(payload, null, 2),
    "```",
  ].join("\n");

  return {
    compactStatus,
    threadMessage,
    payload,
  };
}

export function extractScheduledTaskSummary(
  executedTools: AgenticResult["executedTools"],
): ScheduledTaskSummary | null {
  return extractDiscoveryTriageSummary(executedTools) ?? extractHiveScoutSummary(executedTools);
}
