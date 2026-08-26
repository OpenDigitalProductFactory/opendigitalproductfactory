// BI-5A42E572 / EP-PROACTIVE-OPS — scheduled-job runtime gate.
//
// The read model moved to ./register (one view across both scheduling
// substrates) and the operator mutations moved to ./control (substrate-aware,
// so a change lands on the record the dispatcher actually reads). What remains
// here is the runtime gate the crons themselves call.

import { prisma } from "@dpf/db";

/**
 * Runtime gate for scheduled functions: returns false when an operator has
 * disabled the job. Defaults to enabled when no row exists, so a job that has
 * never been touched runs normally. Wire this into a cron's entry gate to make
 * the per-job kill switch load-bearing.
 */
export async function isJobEnabled(jobId: string): Promise<boolean> {
  const row = await prisma.scheduledJob.findUnique({
    where: { jobId },
    select: { enabled: true },
  });
  return row?.enabled ?? true;
}
