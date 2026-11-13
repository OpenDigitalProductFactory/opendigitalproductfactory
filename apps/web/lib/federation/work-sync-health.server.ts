// Loader for the "stale since" marker on mirrored-item counts (BI-85DE8EBD).

import type { prisma } from "@dpf/db";

import { WORK_SYNC_HEALTH_KEY } from "./work-sync";
import { mirrorsStaleSince, parseWorkSyncHealthRecord } from "./work-sync-health";

/** When mirrored items went stale, or null while every link syncs. Never throws: a failed read shows no marker. */
export async function loadWorkSyncStaleSince(db: Pick<typeof prisma, "platformConfig">): Promise<Date | null> {
  try {
    const row = await db.platformConfig.findUnique({ where: { key: WORK_SYNC_HEALTH_KEY }, select: { value: true } });
    return mirrorsStaleSince(parseWorkSyncHealthRecord(row?.value));
  } catch {
    return null;
  }
}
