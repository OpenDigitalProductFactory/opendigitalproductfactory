import type {
  OperationsMapA2aEdge,
  OperationsMapA2aEdgeKind,
  OperationsMapA2aInteractionState,
  OperationsMapA2aLegendItem,
  OperationsMapRoutingCoworker,
  OperationsMapRoutingMarkerType,
  OperationsMapRoutingTimelineMarker,
} from "./types";
import type { RoutingCoworkerSourceRow } from "./project-routing-topology";

/**
 * Coworker-to-coworker (A2A) interaction projection.
 *
 * Pure function (no Prisma, no React) — same contract as
 * `project-routing-topology.ts`. It reads rows from substrate that already
 * exists today and maps them into typed A2A edges between two coworkers:
 *
 *   DelegationChain   → a2a-delegation   (fromAgentId → toAgentId)
 *   PhaseHandoff      → a2a-handoff      (fromAgentId → toAgentId, build phase)
 *   TaskRun lineage   → a2a-task-lineage (parent/initiating agent → current agent)
 *   DeliberationRun   → a2a-deliberation (coordinator → each branch persona)
 *
 * No migration is required; the loader resolves the raw rows into the source
 * DTOs below. See
 * docs/superpowers/specs/2026-06-04-ai-operations-map-a2a-interaction-visibility-design.md
 */

export type A2aDelegationSourceRow = {
  id: string;
  chainId: string;
  depth: number;
  fromAgentId: string;
  toAgentId: string;
  skillId: string | null;
  authorityScope: string[];
  status: string;
  reason: string | null;
  startedAt: Date;
  completedAt: Date | null;
};

export type A2aPhaseHandoffSourceRow = {
  id: string;
  buildId: string | null;
  fromPhase: string;
  toPhase: string;
  fromAgentId: string;
  toAgentId: string;
  summary: string;
  /** Loader-resolved from PhaseHandoff.gateResult JSON; null when unknown. */
  gatePassed: boolean | null;
  gateLabel: string | null;
  tokenBudgetUsed: number;
  createdAt: Date;
};

export type A2aTaskLineageSourceRow = {
  id: string;
  taskRunId: string;
  initiatingAgentId: string | null;
  currentAgentId: string | null;
  parentTaskRunId: string | null;
  /** Loader-resolved: parent task's currentAgentId ?? initiatingAgentId. */
  parentAgentId: string | null;
  title: string;
  objective: string | null;
  status: string;
  buildId: string | null;
  startedAt: Date;
};

export type A2aDeliberationBranchRow = {
  nodeId: string;
  agentId: string | null;
  workerRole: string | null;
  status: string | null;
};

export type A2aDeliberationSourceRow = {
  id: string;
  /** Loader-resolved from the parent TaskRun (current ?? initiating agent). */
  coordinatorAgentId: string | null;
  patternLabel: string | null;
  consensusState: string;
  taskRunId: string;
  startedAt: Date;
  branches: A2aDeliberationBranchRow[];
};

export type A2aInteractionInput = {
  agents: RoutingCoworkerSourceRow[];
  delegationChains: A2aDelegationSourceRow[];
  phaseHandoffs: A2aPhaseHandoffSourceRow[];
  taskLineage: A2aTaskLineageSourceRow[];
  deliberations: A2aDeliberationSourceRow[];
};

export type A2aInteractionProjection = {
  a2aEdges: OperationsMapA2aEdge[];
  coworkers: OperationsMapRoutingCoworker[];
  timeline: OperationsMapRoutingTimelineMarker[];
  legend: OperationsMapA2aLegendItem[];
};

export const A2A_INTERACTION_LEGEND: OperationsMapA2aLegendItem[] = [
  {
    edgeKind: "a2a-delegation",
    label: "Delegation",
    description: "One coworker delegated authority-bearing work to another coworker.",
  },
  {
    edgeKind: "a2a-handoff",
    label: "Phase handoff",
    description: "A build phase was handed from one coworker to the next, with a gate result.",
  },
  {
    edgeKind: "a2a-task-lineage",
    label: "Task lineage",
    description: "A task was spawned or moved from an initiating/parent coworker to the acting coworker.",
  },
  {
    edgeKind: "a2a-deliberation",
    label: "Deliberation",
    description: "A coordinating coworker fanned a decision out to branch personas for peer review.",
  },
];

export function projectA2aInteractions(input: A2aInteractionInput): A2aInteractionProjection {
  const sourceCoworkerById = new Map(input.agents.map((agent) => [agent.agentId, agent]));
  const coworkers: OperationsMapRoutingCoworker[] = [];
  const coworkerById = new Map<string, OperationsMapRoutingCoworker>();
  const a2aEdges: OperationsMapA2aEdge[] = [];
  const timeline: OperationsMapRoutingTimelineMarker[] = [];

  const pushEdge = (edge: OperationsMapA2aEdge | null) => {
    if (!edge) return;
    ensureCoworker(coworkers, coworkerById, edge.fromCoworkerId, sourceCoworkerById);
    ensureCoworker(coworkers, coworkerById, edge.toCoworkerId, sourceCoworkerById);
    a2aEdges.push(edge);
    timeline.push({
      id: `timeline:a2a:${edge.id}`,
      lane: "history",
      label: edge.label,
      occurredAt: edge.occurredAt ?? new Date(0).toISOString(),
      markerType: timelineMarkerType(edge),
    });
  };

  for (const row of input.delegationChains) {
    pushEdge(projectDelegation(row));
  }
  for (const row of input.phaseHandoffs) {
    pushEdge(projectPhaseHandoff(row));
  }
  for (const row of input.taskLineage) {
    pushEdge(projectTaskLineage(row));
  }
  for (const edge of projectDeliberations(input.deliberations)) {
    pushEdge(edge);
  }

  return {
    a2aEdges,
    coworkers: sortByLabel(coworkers),
    timeline,
    legend: A2A_INTERACTION_LEGEND,
  };
}

function projectDelegation(row: A2aDelegationSourceRow): OperationsMapA2aEdge | null {
  const from = normalizeAgentId(row.fromAgentId);
  const to = normalizeAgentId(row.toAgentId);
  if (!isDistinctPair(from, to)) return null;

  return {
    id: `a2a:delegation:${row.id}`,
    edgeKind: "a2a-delegation",
    fromCoworkerId: from,
    toCoworkerId: to,
    state: mapDelegationState(row.status),
    label: row.skillId ? `Delegated ${row.skillId}` : "Delegation",
    summary: row.reason ?? "Coworker delegation",
    occurredAt: row.startedAt.toISOString(),
    authorityScope: row.authorityScope,
    skillId: row.skillId,
    refs: { delegationChainId: row.id },
    weight: clampWeight(row.authorityScope.length || 1),
  };
}

function projectPhaseHandoff(row: A2aPhaseHandoffSourceRow): OperationsMapA2aEdge | null {
  const from = normalizeAgentId(row.fromAgentId);
  const to = normalizeAgentId(row.toAgentId);
  if (!isDistinctPair(from, to)) return null;

  return {
    id: `a2a:handoff:${row.id}`,
    edgeKind: "a2a-handoff",
    fromCoworkerId: from,
    toCoworkerId: to,
    // A recorded handoff already occurred; treat it as completed unless the
    // gate explicitly did not pass, in which case it is a blocked transition.
    state: row.gatePassed === false ? "blocked" : "completed",
    label: `Handoff ${row.fromPhase} → ${row.toPhase}`,
    summary: row.summary,
    occurredAt: row.createdAt.toISOString(),
    buildId: row.buildId,
    gateResult: row.gateLabel,
    refs: { phaseHandoffId: row.id },
    weight: tokenBudgetWeight(row.tokenBudgetUsed),
  };
}

function projectTaskLineage(row: A2aTaskLineageSourceRow): OperationsMapA2aEdge | null {
  const current = normalizeAgentId(row.currentAgentId ?? "");
  // Prefer the resolved parent agent (child task handoff); otherwise the
  // initiating agent (within-task initiator → actor transition).
  const from = row.parentTaskRunId && row.parentAgentId
    ? normalizeAgentId(row.parentAgentId)
    : normalizeAgentId(row.initiatingAgentId ?? "");
  if (!isDistinctPair(from, current)) return null;

  return {
    id: `a2a:lineage:${row.id}`,
    edgeKind: "a2a-task-lineage",
    fromCoworkerId: from,
    toCoworkerId: current,
    state: mapTaskState(row.status),
    label: row.title || "Task lineage",
    summary: row.objective ?? row.title ?? "Task handoff",
    occurredAt: row.startedAt.toISOString(),
    buildId: row.buildId,
    refs: { taskRunId: row.taskRunId, parentTaskRunId: row.parentTaskRunId },
    weight: 2,
  };
}

function projectDeliberations(rows: A2aDeliberationSourceRow[]): OperationsMapA2aEdge[] {
  const edges: OperationsMapA2aEdge[] = [];
  for (const run of rows) {
    const coordinator = normalizeAgentId(run.coordinatorAgentId ?? "");
    if (!coordinator) continue;

    // Aggregate branches per distinct branch agent so a deliberation that
    // assigned several branches to the same persona renders as one weighted
    // edge rather than a cluttered fan.
    const branchesByAgent = new Map<string, A2aDeliberationBranchRow[]>();
    for (const branch of run.branches) {
      const agentId = normalizeAgentId(branch.agentId ?? "");
      if (!isDistinctPair(coordinator, agentId)) continue;
      const list = branchesByAgent.get(agentId) ?? [];
      list.push(branch);
      branchesByAgent.set(agentId, list);
    }

    for (const [agentId, branches] of branchesByAgent) {
      edges.push({
        id: `a2a:deliberation:${run.id}:${agentId}`,
        edgeKind: "a2a-deliberation",
        fromCoworkerId: coordinator,
        toCoworkerId: agentId,
        state: mapDeliberationState(run.consensusState, branches),
        label: run.patternLabel ? `Deliberation: ${run.patternLabel}` : "Deliberation",
        summary: branchRoleSummary(branches),
        occurredAt: run.startedAt.toISOString(),
        gateResult: run.consensusState,
        refs: { deliberationRunId: run.id, taskRunId: run.taskRunId },
        weight: clampWeight(branches.length),
      });
    }
  }
  return edges;
}

// ─── State mapping ────────────────────────────────────────────────────

function mapDelegationState(status: string): OperationsMapA2aInteractionState {
  switch (status.trim().toLowerCase()) {
    case "completed":
      return "completed";
    case "failed":
      return "failed";
    case "blocked":
      return "blocked";
    default:
      return "active";
  }
}

function mapTaskState(status: string): OperationsMapA2aInteractionState {
  switch (status.trim().toLowerCase()) {
    case "completed":
    case "archived":
      return "completed";
    case "failed":
    case "rejected":
      return "failed";
    case "canceled":
    case "cancelled":
      return "blocked";
    default:
      // submitted | working | input-required | auth-required
      return "active";
  }
}

function mapDeliberationState(
  consensusState: string,
  branches: A2aDeliberationBranchRow[],
): OperationsMapA2aInteractionState {
  // A failed/blocked branch dominates the per-agent edge state.
  if (branches.some((branch) => branchFailed(branch.status))) return "failed";
  switch (consensusState.trim().toLowerCase()) {
    case "consensus":
    case "partial-consensus":
      return "completed";
    case "no-consensus":
    case "insufficient-evidence":
      return "failed";
    default:
      return "active";
  }
}

function branchFailed(status: string | null): boolean {
  const value = (status ?? "").trim().toLowerCase();
  return value === "failed" || value === "cancelled" || value === "canceled";
}

function branchRoleSummary(branches: A2aDeliberationBranchRow[]): string {
  const roles = branches
    .map((branch) => branch.workerRole)
    .filter((role): role is string => Boolean(role));
  if (roles.length === 0) return "Deliberation branch review";
  return `Branch roles: ${[...new Set(roles)].join(", ")}`;
}

// ─── Helpers ──────────────────────────────────────────────────────────

function normalizeAgentId(agentId: string): string {
  const normalized = agentId.trim();
  if (!normalized || /^unknown$/i.test(normalized)) return "";
  return normalized;
}

function isDistinctPair(from: string, to: string): boolean {
  return Boolean(from) && Boolean(to) && from !== to;
}

function clampWeight(value: number): number {
  return Math.min(5, Math.max(1, Math.round(value)));
}

function tokenBudgetWeight(tokens: number): number {
  if (tokens >= 100_000) return 5;
  if (tokens >= 25_000) return 4;
  if (tokens >= 5_000) return 3;
  if (tokens >= 500) return 2;
  return 1;
}

function timelineMarkerType(edge: OperationsMapA2aEdge): OperationsMapRoutingMarkerType {
  if (edge.state === "failed" || edge.state === "blocked") return "error";
  if (edge.edgeKind === "a2a-deliberation") return "governance";
  return "decision";
}

function ensureCoworker(
  coworkers: OperationsMapRoutingCoworker[],
  coworkerById: Map<string, OperationsMapRoutingCoworker>,
  agentId: string,
  sourceCoworkerById: Map<string, RoutingCoworkerSourceRow>,
) {
  if (!agentId || coworkerById.has(agentId)) return;
  const source = sourceCoworkerById.get(agentId);
  const coworker: OperationsMapRoutingCoworker = {
    agentId,
    label: source?.name ?? titleize(agentId),
    stationLabel: source?.stationLabel ?? null,
  };
  coworkers.push(coworker);
  coworkerById.set(agentId, coworker);
}

function sortByLabel<T extends { label: string }>(items: T[]): T[] {
  return [...items].sort((left, right) => left.label.localeCompare(right.label));
}

function titleize(value: string): string {
  return (
    value
      .split(/[-_:.\s]+/)
      .filter(Boolean)
      .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
      .join(" ") || "Unknown"
  );
}

const _edgeKindGuard: Record<OperationsMapA2aEdgeKind, true> = {
  "a2a-delegation": true,
  "a2a-handoff": true,
  "a2a-task-lineage": true,
  "a2a-deliberation": true,
};
void _edgeKindGuard;
