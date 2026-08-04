/**
 * The B-class "recent portal / MCP activity" signal used by the quiescence
 * drain (`request.recent-tool-execution`).
 *
 * It lives in its own module because it is a POLICY about what counts as
 * activity, not a query detail: what it excludes has twice been the difference
 * between a self-upgrade that runs and one that cannot.
 */
import type { Prisma } from "@dpf/db";

/** Edge-node agents heartbeat continuously and are not interactive work. */
export const EDGE_AGENT_PREFIX = "edge-node:";

/**
 * The auditClass `deriveAuditClassForTool` assigns a tool with neither a side
 * effect nor external access — a pure observation.
 */
export const OBSERVING_TOOL_AUDIT_CLASS = "metrics_only";

/**
 * Rows that count as activity in the window starting at `cutoff`.
 *
 * A WAITER MUST NOT COUNT AS ACTIVITY (BI-2C7F51BA). Every MCP call writes a
 * ToolExecution row, INCLUDING read-only ones, so an agent asking "is it safe to
 * proceed?" re-arms the very blocker it is asking about: a local-CI gate polling
 * get_quiescence_status while it waited for the drain kept this surface armed at
 * count 1 — its own poll — and the diagnostic call used to inspect the stall did
 * the same. The signal was measuring observation, not work.
 *
 * Excluding observation extends the mechanism the edge-node clause already
 * established, and reuses the argument BI-CC82B9A8 recorded one stage earlier at
 * TRIGGER time (queue/functions/self-upgrade.ts): the soft
 * `request.recent-tool-execution` surface fires on the very calls that drove the
 * request. Narrowing the SIGNAL is deliberately preferred over discounting soft
 * blockers at swap time — the unattended scheduled path must stay conservative
 * and never drain while real work is in flight (BI-F36E7510), and it still does:
 * only observation is excluded, while every mutating (`ledger`) and
 * external-reaching (`journal`) call still arms the blocker.
 *
 * Null classes are pre-Phase-3 rows with no classification. They keep counting
 * (fail closed) rather than being swept in by a bare `NOT auditClass =
 * 'metrics_only'`, which SQL evaluates to NULL — and therefore drops — for them.
 */
export function recentActivityWhere(cutoff: Date): Prisma.ToolExecutionWhereInput {
  return {
    createdAt: { gte: cutoff },
    NOT: { agentId: { startsWith: EDGE_AGENT_PREFIX } },
    OR: [
      { auditClass: null },
      { auditClass: { not: OBSERVING_TOOL_AUDIT_CLASS } },
    ],
  };
}
