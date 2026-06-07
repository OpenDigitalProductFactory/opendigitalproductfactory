import type { AuditClass } from "@/lib/audit-classes";
import type { TaskState } from "@/lib/tak/task-states";
import { SOFTWARE_PLATFORM_MAP_TEMPLATE } from "./templates";
import type {
  OperationsMapAgent,
  OperationsMapBacklogEvidence,
  OperationsMapExternalEvidence,
  OperationsMapProjection,
  OperationsMapProjectionFilters,
  OperationsMapProjectionSource,
  OperationsMapQuickView,
  OperationsMapQuickViewId,
  OperationsMapSeverity,
  OperationsMapTaskRun,
  OperationsMapTemplate,
  OperationsMapToolExecution,
  OperationsMapToolExecutionReceipt,
  StationedOperationsMapAgent,
} from "./types";

const VALUE_STREAM_TO_STATION: Record<string, string> = {
  evaluate: "evaluate",
  explore: "explore",
  integrate: "integrate",
  deploy: "deploy",
  release: "release",
  consume: "consume",
  operate: "operate",
  governance: "governance",
  "cross-cutting": "cross-cutting",
};

const MSP_VALUE_STREAM_TO_STATION: Record<string, string> = {
  evaluate: "customer-intake",
  explore: "customer-intake",
  integrate: "service-operations",
  deploy: "service-operations",
  release: "lifecycle-review",
  consume: "customer-estate",
  operate: "service-operations",
  "cross-cutting": "improvement",
};

const AGENT_ID_TO_STATION_HINTS: Array<{ pattern: RegExp; stationId: string }> = [
  { pattern: /scout|research|discover/i, stationId: "explore" },
  { pattern: /backlog|portfolio|triage|evaluate/i, stationId: "evaluate" },
  { pattern: /architect|design|ux|plan|integrate/i, stationId: "integrate" },
  { pattern: /build|code|developer|specialist/i, stationId: "build" },
  { pattern: /review|verify|verification|qa|test/i, stationId: "verify" },
  { pattern: /deploy|environment/i, stationId: "deploy" },
  { pattern: /release|deploy|ship/i, stationId: "release" },
  { pattern: /consume|customer|experience/i, stationId: "consume" },
  { pattern: /support|admin|ops|operate|diagnostic/i, stationId: "operate" },
  { pattern: /govern|compliance|policy|authority/i, stationId: "governance" },
  { pattern: /service|incident|help.?desk|diagnostic/i, stationId: "service-operations" },
  { pattern: /estate|site|configuration|asset/i, stationId: "customer-estate" },
  { pattern: /agreement|sla|entitlement/i, stationId: "agreements" },
  { pattern: /billing|charge|invoice/i, stationId: "billing-readiness" },
  { pattern: /lifecycle|renewal|review/i, stationId: "lifecycle-review" },
];

const ROUTE_CONTEXT_TO_STATION: Array<{ pattern: RegExp; stationId: string }> = [
  { pattern: /discover|research|scout|explore/i, stationId: "explore" },
  { pattern: /backlog|portfolio|triage|evaluate/i, stationId: "evaluate" },
  { pattern: /design|plan|architect|integrate/i, stationId: "integrate" },
  { pattern: /build|sandbox|code/i, stationId: "build" },
  { pattern: /verify|verification|review|test|qa/i, stationId: "verify" },
  { pattern: /deploy|environment/i, stationId: "deploy" },
  { pattern: /release|deploy|ship/i, stationId: "release" },
  { pattern: /consume|customer|experience/i, stationId: "consume" },
  { pattern: /support|admin|ops|operate|diagnostic/i, stationId: "operate" },
  { pattern: /govern|compliance|policy|authority/i, stationId: "governance" },
  { pattern: /service-operations|incident|help.?desk|diagnostic/i, stationId: "service-operations" },
  { pattern: /customer-estate|site|configuration|asset/i, stationId: "customer-estate" },
  { pattern: /agreement|sla|entitlement/i, stationId: "agreements" },
  { pattern: /billing|charge|invoice/i, stationId: "billing-readiness" },
  { pattern: /lifecycle|renewal|review/i, stationId: "lifecycle-review" },
];

const ALL_PROJECTION_SOURCES: OperationsMapProjectionSource[] = [
  "task-run",
  "tool-execution",
  "tool-receipt",
  "evidence-backlog",
  "evidence-external",
];

const ALL_PROJECTION_SEVERITIES: OperationsMapSeverity[] = ["normal", "attention", "warning", "critical"];

export const OPERATIONS_MAP_QUICK_VIEWS = [
  {
    id: "all",
    label: "All activity",
    description: "Show every projected activity source and severity.",
    filters: {
      sources: ALL_PROJECTION_SOURCES,
      severities: ALL_PROJECTION_SEVERITIES,
    },
  },
  {
    id: "exceptions",
    label: "Exceptions",
    description: "Show activity that needs attention, warning, or critical review.",
    filters: {
      sources: ALL_PROJECTION_SOURCES,
      severities: ["attention", "warning", "critical"],
    },
  },
  {
    id: "evidence",
    label: "Evidence only",
    description: "Show receipts, backlog evidence, and external evidence records.",
    filters: {
      sources: ["tool-receipt", "evidence-backlog", "evidence-external"],
      severities: ALL_PROJECTION_SEVERITIES,
    },
  },
  {
    id: "tool-runs",
    label: "Tool runs",
    description: "Show raw tool execution events only.",
    filters: {
      sources: ["tool-execution"],
      severities: ALL_PROJECTION_SEVERITIES,
    },
  },
] satisfies OperationsMapQuickView[];

export function getOperationsMapQuickViewFilters(viewId: OperationsMapQuickViewId): OperationsMapProjectionFilters {
  const view = OPERATIONS_MAP_QUICK_VIEWS.find((candidate) => candidate.id === viewId) ?? OPERATIONS_MAP_QUICK_VIEWS[0];

  return {
    sources: [...view.filters.sources],
    severities: [...view.filters.severities],
  };
}

export function deriveProjectionSeverityFromTaskState(state: TaskState): OperationsMapSeverity {
  switch (state) {
    case "failed":
    case "rejected":
      return "critical";
    case "input-required":
    case "auth-required":
      // Stalled is recoverable (operator can Retry/Abandon) — treat as
      // attention-grade, not critical. See BI-4ab6be39 §9.1.
      return "attention";
    case "stalled":
      return "attention";
    case "quiescing":
    case "paused-for-upgrade":
    case "paused-for-upgrade-forced":
      // BI-QUIESCE-001 — quiescence-related pauses surface in the AI
      // Operations Map attention bucket alongside stalled/input-required.
      // Operator-actionable: the thread either has a Resume button (the
      // "paused-for-upgrade*" variants) or is mid cooperative cancel
      // ("quiescing") and will transition shortly. Forced-pause carries a
      // truncated-response warning at the Resume site, not here.
      return "attention";
    case "submitted":
    case "working":
    case "completed":
    case "canceled":
    case "archived":
      return "normal";
    default: {
      const exhaustive: never = state;
      return exhaustive;
    }
  }
}

export function deriveProjectionSeverityFromToolExecution(
  row: Pick<OperationsMapToolExecution, "success" | "auditClass">,
): OperationsMapSeverity {
  if (row.success) return "normal";
  return row.auditClass === "ledger" ? "critical" : "warning";
}

export function deriveProjectionSeverityFromToolReceipt(
  row: Pick<OperationsMapToolExecutionReceipt, "receiptStatus" | "executionStatus">,
): OperationsMapSeverity {
  if (row.receiptStatus !== "valid") return "warning";
  if (/fail|error|denied|rejected/i.test(row.executionStatus)) return "warning";
  return "normal";
}

export function projectAgentsToStations(
  agents: OperationsMapAgent[],
  template: OperationsMapTemplate,
): StationedOperationsMapAgent[] {
  return agents.map((agent) => {
    const stationId = resolveAgentStationId(agent, template);
    const station = template.stations.find((candidate) => candidate.id === stationId) ?? template.stations[0];

    return {
      ...agent,
      stationId: station.id,
      stationLabel: station.label,
    };
  });
}

export function projectToolExecution(
  row: OperationsMapToolExecution,
  template: OperationsMapTemplate = SOFTWARE_PLATFORM_MAP_TEMPLATE,
): OperationsMapProjection {
  const stationId = resolveToolExecutionStationId(row, template);
  const severity = deriveProjectionSeverityFromToolExecution(row);
  const outcome = row.success ? "completed" : "failed";

  return {
    id: `tool:${row.id}`,
    occurredAt: row.createdAt.toISOString(),
    actorAgentId: row.agentId,
    source: "tool-execution",
    location: {
      lineId: resolveLineId(stationId, template),
      stationId,
    },
    severity,
    label: row.toolName,
    summary: row.summary ?? `${row.toolName} ${outcome}`,
    refs: {
      threadId: row.threadId,
      toolExecutionId: row.id,
      capabilityId: row.capabilityId,
    },
    links: {
      authorityHref: `/platform/audit/ledger?toolExecutionId=${encodeURIComponent(row.id)}`,
      coworkerHref: `/platform/ai/agent/${encodeURIComponent(row.agentId)}`,
    },
  };
}

export function projectTaskRun(
  row: OperationsMapTaskRun,
  template: OperationsMapTemplate = SOFTWARE_PLATFORM_MAP_TEMPLATE,
): OperationsMapProjection {
  const stationId = resolveTaskRunStationId(row, template);
  const label = row.source === "proactive" ? "Scheduled task run" : "Task run";

  return {
    id: `task-run:${row.id}`,
    occurredAt: row.startedAt.toISOString(),
    actorAgentId: row.currentAgentId,
    source: "task-run",
    location: {
      lineId: resolveLineId(stationId, template),
      stationId,
    },
    severity: severityForTaskRunStatus(row.status),
    label,
    summary: `${row.title} (${row.status})`,
    refs: {
      taskRunId: row.taskRunId,
    },
    links: {
      historyHref: `/api/internal/tasks/${encodeURIComponent(row.taskRunId)}`,
      coworkerHref: row.currentAgentId
        ? `/platform/ai/agent/${encodeURIComponent(row.currentAgentId)}`
        : undefined,
    },
  };
}

export function projectToolExecutionReceipt(
  row: OperationsMapToolExecutionReceipt,
  template: OperationsMapTemplate = SOFTWARE_PLATFORM_MAP_TEMPLATE,
): OperationsMapProjection {
  const stationId = row.toolExecution
    ? resolveToolExecutionStationId(row.toolExecution, template)
    : resolveFallbackStationId(template);
  const label = `${row.receiptKind} receipt`;
  const toolExecutionId = row.toolExecution?.id ?? row.toolExecutionId;

  return {
    id: `receipt:${row.id}`,
    occurredAt: row.createdAt.toISOString(),
    actorAgentId: row.toolExecution?.agentId ?? null,
    source: "tool-receipt",
    location: {
      lineId: resolveLineId(stationId, template),
      stationId,
    },
    severity: deriveProjectionSeverityFromToolReceipt(row),
    label,
    summary: `${label} ${row.receiptStatus} for ${row.toolExecution?.toolName ?? row.toolExecutionId}`,
    refs: {
      threadId: row.toolExecution?.threadId ?? null,
      toolExecutionId,
      toolReceiptId: row.id,
      buildId: row.buildId,
      capabilityId: row.toolExecution?.capabilityId ?? null,
    },
    links: {
      authorityHref: row.toolExecution
        ? `/platform/audit/ledger?toolExecutionId=${encodeURIComponent(toolExecutionId)}`
        : undefined,
      coworkerHref: row.toolExecution
        ? `/platform/ai/agent/${encodeURIComponent(row.toolExecution.agentId)}`
        : undefined,
      historyHref: `/platform/ai/history?toolReceiptId=${encodeURIComponent(row.id)}`,
    },
  };
}

export function projectBacklogEvidence(
  row: OperationsMapBacklogEvidence,
  template: OperationsMapTemplate = SOFTWARE_PLATFORM_MAP_TEMPLATE,
): OperationsMapProjection {
  const stationId = resolveEvidenceStationId(row.summary, template);
  const backlogItemRef = row.backlogItem?.itemId ?? row.backlogItemId;

  return {
    id: `backlog-evidence:${row.id}`,
    occurredAt: row.recordedAt.toISOString(),
    actorAgentId: row.recordedByAgentId,
    source: "evidence-backlog",
    location: {
      lineId: resolveLineId(stationId, template),
      stationId,
    },
    severity: "normal",
    label: "Backlog evidence",
    summary: row.summary,
    refs: {
      backlogItemActivityId: row.id,
      backlogItemId: backlogItemRef,
      toolExecutionId: row.toolExecutionId,
    },
    links: {
      backlogHref: `/ops?itemId=${encodeURIComponent(backlogItemRef)}`,
      authorityHref: row.toolExecutionId
        ? `/platform/audit/ledger?toolExecutionId=${encodeURIComponent(row.toolExecutionId)}`
        : undefined,
      coworkerHref: row.recordedByAgentId
        ? `/platform/ai/agent/${encodeURIComponent(row.recordedByAgentId)}`
        : undefined,
    },
  };
}

export function projectExternalEvidence(
  row: OperationsMapExternalEvidence,
  template: OperationsMapTemplate = SOFTWARE_PLATFORM_MAP_TEMPLATE,
): OperationsMapProjection {
  const stationId = resolveRouteStationId(row.routeContext, template) ?? resolveEvidenceStationId(row.resultSummary, template);

  return {
    id: `external-evidence:${row.id}`,
    occurredAt: row.createdAt.toISOString(),
    actorAgentId: null,
    source: "evidence-external",
    location: {
      lineId: resolveLineId(stationId, template),
      stationId,
    },
    severity: "normal",
    label: `${row.provider} ${row.operationType}`,
    summary: row.resultSummary,
    refs: {
      externalEvidenceRecordId: row.id,
    },
    links: {
      historyHref: `/platform/ai/history?externalEvidenceRecordId=${encodeURIComponent(row.id)}`,
    },
  };
}

export function summarizeProjectionCounts(projections: OperationsMapProjection[]) {
  return projections.reduce(
    (counts, projection) => ({
      ...counts,
      [projection.severity]: counts[projection.severity] + 1,
    }),
    { normal: 0, attention: 0, warning: 0, critical: 0 } satisfies Record<OperationsMapSeverity, number>,
  );
}

export function filterOperationsMapProjections(
  projections: OperationsMapProjection[],
  filters: OperationsMapProjectionFilters,
): OperationsMapProjection[] {
  if (filters.sources.length === 0 || filters.severities.length === 0) return [];

  const sources = new Set(filters.sources);
  const severities = new Set(filters.severities);

  return projections.filter((projection) => sources.has(projection.source) && severities.has(projection.severity));
}

function resolveAgentStationId(agent: OperationsMapAgent, template: OperationsMapTemplate): string {
  const stationIds = new Set(template.stations.map((station) => station.id));
  const byValueStream = agent.valueStream ? resolveValueStreamStationId(agent.valueStream, template) : null;
  if (byValueStream && stationIds.has(byValueStream)) return byValueStream;
  if (agent.valueStream) return resolveFallbackStationId(template);

  const searchable = `${agent.agentId} ${agent.slugId ?? ""} ${agent.name} ${agent.type}`;
  const direct = resolveDirectTemplateStationId(searchable, template);
  if (direct) return direct;

  const hinted = AGENT_ID_TO_STATION_HINTS.find((hint) => hint.pattern.test(searchable))?.stationId;
  if (hinted && stationIds.has(hinted)) return hinted;

  return resolveFallbackStationId(template);
}

function resolveToolExecutionStationId(row: OperationsMapToolExecution, template: OperationsMapTemplate): string {
  const routeStationId = row.routeContext ? resolveRouteStationId(row.routeContext, template) : null;
  if (routeStationId) return routeStationId;

  const agentDirect = resolveDirectTemplateStationId(row.agentId, template);
  if (agentDirect) return agentDirect;

  const agentHint = AGENT_ID_TO_STATION_HINTS.find((hint) => hint.pattern.test(row.agentId))?.stationId;
  if (agentHint && template.stations.some((station) => station.id === agentHint)) return agentHint;

  return resolveFallbackStationId(template);
}

function resolveTaskRunStationId(row: OperationsMapTaskRun, template: OperationsMapTemplate): string {
  const routeStationId = row.routeContext ? resolveRouteStationId(row.routeContext, template) : null;
  if (routeStationId) return routeStationId;

  const agentId = row.currentAgentId ?? "";
  const agentDirect = agentId ? resolveDirectTemplateStationId(agentId, template) : null;
  if (agentDirect) return agentDirect;

  const agentHint = AGENT_ID_TO_STATION_HINTS.find((hint) => hint.pattern.test(agentId))?.stationId;
  if (agentHint && template.stations.some((station) => station.id === agentHint)) return agentHint;

  return resolveFallbackStationId(template);
}

function severityForTaskRunStatus(status: string): OperationsMapSeverity {
  if (status === "failed" || status === "rejected") return "critical";
  // BI-4ab6be39 — stalled is operator-actionable: surfaces with attention
  // severity so it filters alongside input-required / auth-required in the
  // AI Operations Map projection list, and so ProjectionInspector's
  // StalledTaskRecoveryActions component receives projections with the
  // right summary suffix. Without this, stalled rows fell through to
  // "normal" and were invisible to the attention filter (caught in the
  // F1+F2 UX dogfooding pass, 2026-05-20).
  if (status === "input-required" || status === "auth-required" || status === "stalled") return "attention";
  return "normal";
}

function resolveEvidenceStationId(value: string, template: OperationsMapTemplate): string {
  return resolveRouteStationId(value, template) ?? resolveFallbackStationId(template);
}

function resolveRouteStationId(value: string, template: OperationsMapTemplate): string | null {
  const routeDirect = resolveDirectTemplateStationId(value, template);
  if (routeDirect) return routeDirect;

  const routeHint = ROUTE_CONTEXT_TO_STATION.find((hint) => hint.pattern.test(value))?.stationId;
  if (routeHint && template.stations.some((station) => station.id === routeHint)) return routeHint;

  return null;
}

function resolveValueStreamStationId(valueStream: string, template: OperationsMapTemplate): string | null {
  const map = template.id === "managed-service-provider" ? MSP_VALUE_STREAM_TO_STATION : VALUE_STREAM_TO_STATION;
  return map[valueStream] ?? null;
}

function resolveDirectTemplateStationId(value: string, template: OperationsMapTemplate): string | null {
  const normalized = normalizeStationText(value);
  return (
    template.stations.find((station) =>
      [station.id, station.label, station.shortLabel].map(normalizeStationText).includes(normalized),
    )?.id ?? null
  );
}

function resolveLineId(stationId: string, template: OperationsMapTemplate): string {
  return template.lines.find((line) => line.stationIds.includes(stationId))?.id ?? template.lines[0]?.id ?? "flow";
}

function resolveFallbackStationId(template: OperationsMapTemplate): string {
  const stationIds = new Set(template.stations.map((station) => station.id));
  for (const stationId of ["unplaced", "improve", "improvement", "operate"]) {
    if (stationIds.has(stationId)) return stationId;
  }
  return template.stations[0].id;
}

function normalizeStationText(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/(^-|-$)/g, "");
}
