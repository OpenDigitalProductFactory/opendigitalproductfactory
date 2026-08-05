// apps/web/lib/platform-runtime/right-now-activity.ts
//
// The "who's working now" half of the Right Now cockpit (BI-1A68257F). A
// deliberately lean read: the active/attention TaskRuns only, reusing the
// operations-map read model so the shape matches the deep view. This is NOT the
// operations-map projection — no scheduled/forecast rows, no topology; the
// cockpit's job is "right now", not planning.

import { prisma } from "@dpf/db";
import {
  OPERATIONS_RUN_SELECT,
  type OperationsRunRow,
} from "@/lib/ai-operations-map/operations-run-read-model";

/** TaskRun statuses that mean "in flight or waiting on a human, right now". */
const LIVE_STATUSES = ["active", "input-required", "auth-required", "stalled"] as const;

const ACTIVE_WORK_LIMIT = 12;

export type ActiveWorkItem = {
  taskRunId: string;
  title: string | null;
  status: string;
  agentId: string | null;
  startedAt: string | null;
  needsAttention: boolean;
};

export async function loadActiveWork(): Promise<ActiveWorkItem[]> {
  let rows: OperationsRunRow[];
  try {
    rows = await prisma.taskRun.findMany({
      where: { archivedAt: null, status: { in: [...LIVE_STATUSES] } },
      orderBy: { startedAt: "desc" },
      take: ACTIVE_WORK_LIMIT,
      select: OPERATIONS_RUN_SELECT,
    });
  } catch {
    return [];
  }

  return rows.map((row) => ({
    taskRunId: row.taskRunId,
    title: row.title,
    status: row.status,
    agentId: row.currentAgentId,
    startedAt: row.startedAt ? row.startedAt.toISOString() : null,
    needsAttention:
      row.status === "input-required" ||
      row.status === "auth-required" ||
      row.status === "stalled",
  }));
}
