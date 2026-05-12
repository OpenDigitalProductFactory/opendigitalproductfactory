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
  };
};

export type ScheduledTaskSummary = {
  compactStatus: string;
  threadMessage: string;
};

type HiveScoutSummaryPayload = {
  processedAt: string;
  metrics: {
    catalogEntries: number;
    gaps: number;
    created: number;
    duplicates: number;
    deferred: number;
  };
  createdItemIds?: string[];
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function asNumber(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function asString(value: unknown): string | null {
  return typeof value === "string" && value.trim().length > 0 ? value : null;
}

function asBoolean(value: unknown): boolean | null {
  return typeof value === "boolean" ? value : null;
}

export function extractDiscoveryTriageSummary(
  executedTools: AgenticResult["executedTools"],
): ScheduledTaskSummary | null {
  const triageTool = [...executedTools]
    .reverse()
    .find((entry) => entry.name === "run_discovery_triage" && entry.result.success && isRecord(entry.result.data));

  if (!triageTool || !isRecord(triageTool.result.data)) {
    return null;
  }

  const trigger = triageTool.result.data.trigger === "volume" ? "volume" : "cadence";
  const processedAt = asString(triageTool.result.data.processedAt) ?? new Date().toISOString();
  const runIdempotencyKey = asString(triageTool.result.data.runIdempotencyKey);
  const skipped = asBoolean(triageTool.result.data.skipped) ?? false;
  const skipReason = asString(triageTool.result.data.skipReason);
  const metrics = isRecord(triageTool.result.data.metrics) ? triageTool.result.data.metrics : {};

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

  const payload: HiveScoutSummaryPayload = {
    processedAt: new Date().toISOString(),
    metrics: {
      catalogEntries: asNumber(scoutTool.result.data.catalogEntries) ?? 0,
      gaps: asNumber(scoutTool.result.data.gaps) ?? 0,
      created: asNumber(scoutTool.result.data.created) ?? 0,
      duplicates: asNumber(scoutTool.result.data.duplicates) ?? 0,
      deferred: asNumber(scoutTool.result.data.deferred) ?? 0,
    },
    ...(createdItemIds.length > 0 ? { createdItemIds } : {}),
  };

  const compactStatus = [
    "Hive Scout",
    `parsed=${payload.metrics.catalogEntries}`,
    `gaps=${payload.metrics.gaps}`,
    `created=${payload.metrics.created}`,
    `duplicates=${payload.metrics.duplicates}`,
    `deferred=${payload.metrics.deferred}`,
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
  };
}

export function extractScheduledTaskSummary(
  executedTools: AgenticResult["executedTools"],
): ScheduledTaskSummary | null {
  return extractDiscoveryTriageSummary(executedTools) ?? extractHiveScoutSummary(executedTools);
}
