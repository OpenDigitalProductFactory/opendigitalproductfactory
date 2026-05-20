"use server";

import { prisma } from "@dpf/db";

export interface StallEventHistoryEntry {
  id: string;
  taskRunId: string; // cuid
  taskRunBusinessId: string | null;
  phase: string | null;
  reason: string;
  detectedAt: string; // ISO
  outcome: string | null;
  outcomeAt: string | null;
  outcomeBy: string | null;
  notes: string | null;
  thresholdHeartbeatS: number;
  thresholdTotalS: number;
}

/**
 * Recent StallEvents for a given FeatureBuild — newest first. Used by the
 * Build Studio phase panel history strip (BI-4ab6be39 Phase F3) so a
 * repeatedly-stalling build is visible at a glance.
 *
 * Caps at 20 rows. The strip UI renders a small badge per event with the
 * reason and outcome; clicking links to the underlying TaskRun.
 */
export async function getStallEventsForBuild(
  buildId: string,
  limit = 20,
): Promise<StallEventHistoryEntry[]> {
  const rows = await prisma.stallEvent.findMany({
    where: { buildId },
    orderBy: { detectedAt: "desc" },
    take: limit,
    include: {
      taskRun: { select: { taskRunId: true } },
    },
  });

  return rows.map((r) => ({
    id: r.id,
    taskRunId: r.taskRunId,
    taskRunBusinessId: r.taskRun?.taskRunId ?? null,
    phase: r.phase,
    reason: r.reason,
    detectedAt: r.detectedAt.toISOString(),
    outcome: r.outcome,
    outcomeAt: r.outcomeAt?.toISOString() ?? null,
    outcomeBy: r.outcomeBy,
    notes: r.notes,
    thresholdHeartbeatS: r.thresholdHeartbeatS,
    thresholdTotalS: r.thresholdTotalS,
  }));
}
