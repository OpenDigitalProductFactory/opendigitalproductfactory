import type { AuditClass } from "@/lib/audit-classes";
import type { TaskState } from "@/lib/tak/task-states";
import type {
  OperationsMapAgent,
  OperationsMapProjection,
  OperationsMapSeverity,
  OperationsMapTemplate,
  OperationsMapToolExecution,
  StationedOperationsMapAgent,
} from "./types";

const VALUE_STREAM_TO_STATION: Record<string, string> = {
  evaluate: "discover",
  explore: "discover",
  integrate: "build",
  deploy: "release",
  release: "release",
  consume: "support",
  operate: "support",
  "cross-cutting": "improve",
};

const AGENT_ID_TO_STATION_HINTS: Array<{ pattern: RegExp; stationId: string }> = [
  { pattern: /scout|research|discover/i, stationId: "discover" },
  { pattern: /backlog|portfolio|triage/i, stationId: "backlog" },
  { pattern: /architect|design|ux|plan/i, stationId: "design" },
  { pattern: /build|code|developer|specialist/i, stationId: "build" },
  { pattern: /review|verify|qa|test/i, stationId: "verify" },
  { pattern: /release|deploy|ship/i, stationId: "release" },
  { pattern: /support|admin|ops|diagnostic/i, stationId: "support" },
];

const ROUTE_CONTEXT_TO_STATION: Array<{ pattern: RegExp; stationId: string }> = [
  { pattern: /discover|research|scout/i, stationId: "discover" },
  { pattern: /backlog|portfolio|triage/i, stationId: "backlog" },
  { pattern: /design|plan|architect/i, stationId: "design" },
  { pattern: /build|sandbox|code/i, stationId: "build" },
  { pattern: /verify|review|test|qa/i, stationId: "verify" },
  { pattern: /release|deploy|ship/i, stationId: "release" },
  { pattern: /support|admin|ops|diagnostic/i, stationId: "support" },
];

export function deriveProjectionSeverityFromTaskState(state: TaskState): OperationsMapSeverity {
  switch (state) {
    case "failed":
    case "rejected":
      return "critical";
    case "input-required":
    case "auth-required":
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

export function projectToolExecution(row: OperationsMapToolExecution): OperationsMapProjection {
  const stationId = resolveToolExecutionStationId(row);
  const severity = deriveProjectionSeverityFromToolExecution(row);
  const outcome = row.success ? "completed" : "failed";

  return {
    id: `tool:${row.id}`,
    occurredAt: row.createdAt.toISOString(),
    actorAgentId: row.agentId,
    source: "tool-execution",
    location: {
      lineId: "product-flow",
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

export function summarizeProjectionCounts(projections: OperationsMapProjection[]) {
  return projections.reduce(
    (counts, projection) => ({
      ...counts,
      [projection.severity]: counts[projection.severity] + 1,
    }),
    { normal: 0, attention: 0, warning: 0, critical: 0 } satisfies Record<OperationsMapSeverity, number>,
  );
}

function resolveAgentStationId(agent: OperationsMapAgent, template: OperationsMapTemplate): string {
  const stationIds = new Set(template.stations.map((station) => station.id));
  const byValueStream = agent.valueStream ? VALUE_STREAM_TO_STATION[agent.valueStream] : null;
  if (byValueStream && stationIds.has(byValueStream)) return byValueStream;

  const searchable = `${agent.agentId} ${agent.slugId ?? ""} ${agent.name} ${agent.type}`;
  const hinted = AGENT_ID_TO_STATION_HINTS.find((hint) => hint.pattern.test(searchable))?.stationId;
  if (hinted && stationIds.has(hinted)) return hinted;

  return stationIds.has("improve") ? "improve" : template.stations[0].id;
}

function resolveToolExecutionStationId(row: OperationsMapToolExecution): string {
  const routeContext = row.routeContext;
  const routeHint = routeContext
    ? ROUTE_CONTEXT_TO_STATION.find((hint) => hint.pattern.test(routeContext))?.stationId
    : null;
  if (routeHint) return routeHint;

  const agentHint = AGENT_ID_TO_STATION_HINTS.find((hint) => hint.pattern.test(row.agentId))?.stationId;
  return agentHint ?? "improve";
}
