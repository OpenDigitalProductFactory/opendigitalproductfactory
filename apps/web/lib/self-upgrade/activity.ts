import { prisma } from "@dpf/db";

/**
 * Default window: a portal session is considered "active" if any non-edge
 * tool execution landed in the last 5 minutes. This matches typical Next.js
 * server-action cache lifetimes — applying a bundle-hash change inside this
 * window invalidates the operator's cached action ids and breaks every
 * subsequent click until a hard reload.
 *
 * See docs/superpowers/audits/2026-05-21-bs-end-to-end-cycle-blockers.md §5
 * Slice 5 for the architectural reasoning.
 */
export const PORTAL_ACTIVITY_THRESHOLD_MS = 5 * 60 * 1000;

/**
 * Prefix used to identify edge-node heartbeats / adapter polls in the
 * ToolExecution.agentId column. These are background noise and must NOT
 * count as "operator activity" — they fire every 60s and would block every
 * upgrade forever.
 */
export const EDGE_AGENT_PREFIX = "edge-node:";

export type PortalActivitySnapshot = {
  /** True iff a non-edge tool execution landed within `thresholdMs`. */
  active: boolean;
  /** Timestamp of the most recent non-edge tool execution, or null. */
  lastActivityAt: Date | null;
  /** Tool name of the most recent non-edge tool execution, or null. */
  lastActivityToolName: string | null;
  /** The threshold window used for this snapshot, in milliseconds. */
  thresholdMs: number;
};

/**
 * Returns whether the portal has had user-driven activity within the
 * threshold window. Used by self-upgrade to defer bundle-hash changes
 * while operators have live sessions.
 *
 * Edge-node heartbeats are excluded by agentId prefix — they fire on a
 * fixed cadence and are not operator activity.
 *
 * The query is cheap: indexed on (toolName, createdAt) and
 * (agentId, createdAt) on the ToolExecution table; we only need the most
 * recent row matching the filter.
 *
 * Test-only `now` override allows deterministic threshold tests without
 * mocking Date globally.
 */
export async function getPortalActivity(
  thresholdMs: number = PORTAL_ACTIVITY_THRESHOLD_MS,
  now: Date = new Date(),
): Promise<PortalActivitySnapshot> {
  const cutoff = new Date(now.getTime() - thresholdMs);
  const latest = await prisma.toolExecution.findFirst({
    where: {
      createdAt: { gte: cutoff },
      // Exclude edge-node activity — it's background polling, not operator action.
      NOT: { agentId: { startsWith: EDGE_AGENT_PREFIX } },
    },
    orderBy: { createdAt: "desc" },
    select: { createdAt: true, toolName: true },
  });
  return {
    active: latest !== null,
    lastActivityAt: latest?.createdAt ?? null,
    lastActivityToolName: latest?.toolName ?? null,
    thresholdMs,
  };
}
