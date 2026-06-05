import type {
  OperationsMapDeliberation,
  OperationsMapDeliberationBranch,
} from "./types";
import type { RoutingCoworkerSourceRow } from "./project-routing-topology";

/**
 * Deliberation lens projection (Option B — coordinator-internal fan).
 *
 * Pure function (no Prisma, no React). A deliberation branch is NOT a distinct
 * registered coworker today, so this projector deliberately produces a
 * coordinator-side summary (coordinator coworker + branch roster by role and,
 * where the run is diverse, model/provider) rather than coworker↔coworker A2A
 * edges. It never fabricates a coworker identity for a branch.
 *
 * See docs/superpowers/specs/2026-06-05-deliberation-branch-identity-for-a2a-ops-map-design.md
 */

export type DeliberationBranchSourceRow = {
  nodeId: string;
  role: string | null;
  modelId: string | null;
  providerId: string | null;
  status: string | null;
};

export type DeliberationSourceRow = {
  id: string;
  /** Loader-resolved from the parent TaskRun (current ?? initiating agent). */
  coordinatorAgentId: string | null;
  pattern: string | null;
  diversityMode: string;
  consensusState: string;
  startedAt: Date;
  branches: DeliberationBranchSourceRow[];
};

export type DeliberationProjectionInput = {
  agents: RoutingCoworkerSourceRow[];
  deliberations: DeliberationSourceRow[];
};

export function projectDeliberations(input: DeliberationProjectionInput): OperationsMapDeliberation[] {
  const labelByAgentId = new Map(input.agents.map((agent) => [agent.agentId, agent.name]));

  return input.deliberations
    .map((run): OperationsMapDeliberation => {
      const coordinatorId = normalizeAgentId(run.coordinatorAgentId ?? "");
      const branches: OperationsMapDeliberationBranch[] = run.branches.map((branch) => ({
        nodeId: branch.nodeId,
        role: branch.role,
        modelId: branch.modelId,
        providerId: branch.providerId,
        status: branch.status,
      }));

      return {
        id: run.id,
        coordinatorCoworkerId: coordinatorId || null,
        coordinatorLabel: coordinatorId
          ? labelByAgentId.get(coordinatorId) ?? titleize(coordinatorId)
          : "Unattributed coordinator",
        pattern: run.pattern,
        diversityMode: run.diversityMode,
        consensusState: run.consensusState,
        occurredAt: run.startedAt.toISOString(),
        branches,
      };
    })
    .sort((left, right) => occurredAtMs(right.occurredAt) - occurredAtMs(left.occurredAt));
}

function normalizeAgentId(agentId: string): string {
  const normalized = agentId.trim();
  if (!normalized || /^unknown$/i.test(normalized)) return "";
  return normalized;
}

function occurredAtMs(value: string | null): number {
  if (!value) return 0;
  const ms = Date.parse(value);
  return Number.isFinite(ms) ? ms : 0;
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
