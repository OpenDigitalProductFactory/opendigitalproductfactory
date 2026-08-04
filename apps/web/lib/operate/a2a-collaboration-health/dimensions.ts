/**
 * Shared efficiency window vocabulary for MCP tool calls and A2A edges
 * (BI-3003EE63 / BI-A08EBAEC inventory P2).
 *
 * Both planes report the same operator-facing dimensions so thrash on tools
 * and thrash on handoffs can be compared without two dialects.
 */

export const EFFICIENCY_SHARED_DIMENSIONS = [
  "windowStart",
  "windowEnd",
  "actor",
  "session",
  "success",
  "durationMs",
  "surface",
] as const;

export type EfficiencySharedDimension =
  (typeof EFFICIENCY_SHARED_DIMENSIONS)[number];

/** How each plane maps into the shared dimensions. */
export const EFFICIENCY_PLANE_MAPPING = {
  mcp: {
    plane: "mcp-tool",
    actor: "agentId (tool caller)",
    session: "threadId",
    success: "ToolExecution.success",
    durationMs: "ToolExecution.durationMs",
    surface: "executionMode / external-pat",
  },
  a2a: {
    plane: "a2a-collaboration",
    actor: "fromAgentId → toAgentId pair",
    session: "taskRunId | chainId | buildId",
    success: "edge state completed vs failed|blocked",
    durationMs: "completedAt − occurredAt when known",
    surface: "edgeKind (delegation|handoff|lineage|deliberation)",
  },
} as const;
