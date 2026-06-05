// apps/web/lib/ai-operations-map/project-collaboration-transfers.ts
//
// EP-A2A Slice 2 — pure projection of DelegationChain hops into operator-facing
// collaboration transfer edges (coworker -> coworker). Mirrors the pure
// project-routing-topology split from DB loading; no IO here.

import type {
  OperationsMapCollaborationTransfer,
  OperationsMapCollaborationTransferState,
} from "./types";

export type CollaborationTransferRow = {
  id: string;
  fromAgentId: string;
  toAgentId: string;
  status: string;
  reason: string | null;
  startedAt: Date;
};

export type CollaborationTransferInput = {
  delegationChains: CollaborationTransferRow[];
  /** agentId (or slug) -> display label. */
  agentLabels: Record<string, string>;
  limit?: number;
};

function toTransferState(status: string): OperationsMapCollaborationTransferState {
  switch (status) {
    case "blocked":
      return "blocked";
    case "failed":
      return "failed";
    case "completed":
      return "completed";
    default:
      return "active";
  }
}

/**
 * Project DelegationChain rows into transfer edges, newest first. Labels fall
 * back to the agentId when an agent isn't in the label map (fail-open display).
 */
export function projectCollaborationTransfers(
  input: CollaborationTransferInput,
): OperationsMapCollaborationTransfer[] {
  const limit = input.limit ?? 40;
  const label = (id: string) => input.agentLabels[id] ?? id;
  return [...input.delegationChains]
    .sort((a, b) => b.startedAt.getTime() - a.startedAt.getTime())
    .slice(0, limit)
    .map((row) => ({
      id: row.id,
      fromAgentId: row.fromAgentId,
      fromLabel: label(row.fromAgentId),
      toAgentId: row.toAgentId,
      toLabel: label(row.toAgentId),
      state: toTransferState(row.status),
      occurredAt: row.startedAt.toISOString(),
      reason: row.reason,
    }));
}
