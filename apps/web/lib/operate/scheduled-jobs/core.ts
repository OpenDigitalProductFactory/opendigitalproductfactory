// BI-5A42E572 / EP-PROACTIVE-OPS — scheduled-job runtime gate.
//
// The read model moved to ./register (one view across both scheduling
// substrates) and the operator mutations moved to ./control (substrate-aware,
// so a change lands on the record the dispatcher actually reads). What remains
// here is the runtime gate the crons themselves call.

import { prisma } from "@dpf/db";

/**
 * Runtime gate for scheduled functions — THE single implementation of the
 * per-job kill switch (BI-7E49FA15). Returns false only when an operator has
 * set ScheduledJob.enabled=false for this jobId.
 *
 * Posture, stated deliberately:
 *   - No row  → enabled. A job that has never been touched runs normally.
 *   - Read fails → enabled. The switch fails OPEN. A kill switch that failed
 *     closed would take the whole schedule down on a database blip, which is a
 *     far larger blast radius than one extra tick of a job the operator meant
 *     to pause. Before this helper was made canonical, three of five hand-rolled
 *     copies already swallowed the error and ran; this makes that uniform.
 *
 * Reached from gateAtEntry (every catalogued cron) and directly from runners
 * that are also driven by a run-now event, which does not pass through the
 * entry gate.
 */
export async function isJobEnabled(jobId: string): Promise<boolean> {
  try {
    const row = await prisma.scheduledJob.findUnique({
      where: { jobId },
      select: { enabled: true },
    });
    return row?.enabled ?? true;
  } catch {
    return true;
  }
}
