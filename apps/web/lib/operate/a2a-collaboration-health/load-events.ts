/**
 * Load A2A-relevant substrate rows into CollaborationEdgeEvent (BI-3003EE63).
 * Maps the same sources as ops-map projection without React/UI deps.
 */
import { prisma } from "@dpf/db";
import type {
  CollaborationEdgeEvent,
  CollaborationEdgeState,
} from "./analysis";

function mapDelegationState(status: string): CollaborationEdgeState {
  const s = status.toLowerCase();
  if (s === "completed" || s === "success") return "completed";
  if (s === "failed" || s === "error") return "failed";
  if (s === "blocked" || s === "canceled" || s === "cancelled") return "blocked";
  if (s === "active" || s === "running" || s === "pending") return "active";
  return "unknown";
}

function mapTaskState(status: string): CollaborationEdgeState {
  const s = status.toLowerCase();
  if (s === "completed" || s === "archived") return "completed";
  if (s === "failed" || s === "rejected") return "failed";
  if (s === "canceled" || s === "cancelled") return "blocked";
  if (s === "active" || s === "working" || s === "submitted" || s === "awaiting_human")
    return "active";
  return "unknown";
}

function durationMs(
  start: Date,
  end: Date | null | undefined,
): number | null {
  if (!end) return null;
  const d = end.getTime() - start.getTime();
  return d >= 0 ? d : null;
}

export async function loadCollaborationEdgeEvents(
  windowHours = 24,
  limit = 3000,
): Promise<CollaborationEdgeEvent[]> {
  const since = new Date(Date.now() - windowHours * 60 * 60 * 1000);
  const take = Math.min(10_000, Math.max(50, limit));
  const events: CollaborationEdgeEvent[] = [];

  const [delegations, handoffs, taskRuns] = await Promise.all([
    prisma.delegationChain.findMany({
      where: { startedAt: { gte: since } },
      select: {
        id: true,
        chainId: true,
        fromAgentId: true,
        toAgentId: true,
        skillId: true,
        status: true,
        startedAt: true,
        completedAt: true,
      },
      orderBy: { startedAt: "asc" },
      take,
    }),
    prisma.phaseHandoff.findMany({
      where: { createdAt: { gte: since } },
      select: {
        id: true,
        buildId: true,
        fromAgentId: true,
        toAgentId: true,
        gateResult: true,
        createdAt: true,
      },
      orderBy: { createdAt: "asc" },
      take,
    }),
    prisma.taskRun.findMany({
      where: { startedAt: { gte: since } },
      select: {
        id: true,
        taskRunId: true,
        initiatingAgentId: true,
        currentAgentId: true,
        parentTaskRunId: true,
        title: true,
        status: true,
        startedAt: true,
        completedAt: true,
      },
      orderBy: { startedAt: "asc" },
      take,
    }),
  ]);

  for (const row of delegations) {
    if (!row.fromAgentId || !row.toAgentId || row.fromAgentId === row.toAgentId)
      continue;
    events.push({
      id: `delegation:${row.id}`,
      edgeKind: "a2a-delegation",
      fromAgentId: row.fromAgentId,
      toAgentId: row.toAgentId,
      state: mapDelegationState(row.status),
      occurredAt: row.startedAt,
      completedAt: row.completedAt,
      skillId: row.skillId,
      sessionId: row.chainId,
      durationMs: durationMs(row.startedAt, row.completedAt),
    });
  }

  for (const row of handoffs) {
    if (!row.fromAgentId || !row.toAgentId || row.fromAgentId === row.toAgentId)
      continue;
    // gateResult may be JSON or string; treat explicit false / failed as blocked
    let gatePassed: boolean | null = null;
    const gr = row.gateResult as unknown;
    if (typeof gr === "boolean") gatePassed = gr;
    else if (gr && typeof gr === "object" && "passed" in gr) {
      gatePassed = Boolean((gr as { passed?: unknown }).passed);
    } else if (typeof gr === "string") {
      const lower = gr.toLowerCase();
      if (lower.includes("fail") || lower.includes("block")) gatePassed = false;
      else if (lower.includes("pass")) gatePassed = true;
    }
    events.push({
      id: `handoff:${row.id}`,
      edgeKind: "a2a-handoff",
      fromAgentId: row.fromAgentId,
      toAgentId: row.toAgentId,
      state: gatePassed === false ? "blocked" : "completed",
      occurredAt: row.createdAt,
      completedAt: row.createdAt,
      sessionId: row.buildId,
      durationMs: null,
    });
  }

  // Parent agent resolution within the fetched set
  const byTaskRunId = new Map(
    taskRuns.map((t) => [t.taskRunId ?? t.id, t] as const),
  );
  for (const row of taskRuns) {
    const current = row.currentAgentId;
    if (!current) continue;
    let from: string | null = row.initiatingAgentId;
    let orphanParent = false;
    if (row.parentTaskRunId) {
      const parent = byTaskRunId.get(row.parentTaskRunId);
      if (parent) {
        from = parent.currentAgentId ?? parent.initiatingAgentId;
      } else {
        orphanParent = true;
        from = row.initiatingAgentId ?? "unknown-parent";
      }
    }
    if (!from || from === current) {
      if (orphanParent) {
        events.push({
          id: `lineage:${row.id}`,
          edgeKind: "a2a-task-lineage",
          fromAgentId: from ?? "unknown-parent",
          toAgentId: current,
          state: mapTaskState(row.status),
          occurredAt: row.startedAt,
          completedAt: row.completedAt,
          orphanParent: true,
          title: row.title,
          sessionId: row.taskRunId ?? row.id,
          durationMs: durationMs(row.startedAt, row.completedAt),
        });
      }
      continue;
    }
    events.push({
      id: `lineage:${row.id}`,
      edgeKind: "a2a-task-lineage",
      fromAgentId: from,
      toAgentId: current,
      state: mapTaskState(row.status),
      occurredAt: row.startedAt,
      completedAt: row.completedAt,
      orphanParent,
      title: row.title,
      sessionId: row.taskRunId ?? row.id,
      durationMs: durationMs(row.startedAt, row.completedAt),
    });
  }

  return events.sort(
    (a, b) => a.occurredAt.getTime() - b.occurredAt.getTime(),
  );
}
