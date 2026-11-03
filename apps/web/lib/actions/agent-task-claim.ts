import type { prisma, Prisma } from "@dpf/db";
import { computeNextCronRun, isOneShotCron } from "@/lib/operate/cron-next-run";
import { scheduledReportingScopeDigest } from "@/lib/operate/scheduled-jobs/scheduled-reporting-contract";

/** Current commission/run and its mirror writes share one owner-row lock.
 * A prior ordinary continuation cannot undo a newly narrowed or parked watch. */
export async function withCurrentScheduledTask<T>(
  db: Pick<typeof prisma, "$transaction">, original: Record<string, unknown>, expectedRunId: string | null,
  write: (tx: Prisma.TransactionClient) => Promise<T>, requireWorking = false, beforeCadence = false,
): Promise<T | null> {
  const taskId = typeof original.taskId === "string" ? original.taskId : "";
  const owner = typeof original.ownerUserId === "string" ? original.ownerUserId : "";
  if (!taskId || !owner) return null;
  return db.$transaction(async tx => {
    const locked = await tx.$queryRaw<Array<{ taskId: string }>>`SELECT "taskId" FROM "ScheduledAgentTask" WHERE "taskId" = ${taskId} AND "ownerUserId" = ${owner} FOR UPDATE`;
    if (locked.length !== 1) return null;
    const current = await tx.scheduledAgentTask.findUnique({ where: { taskId } });
    const expected = !beforeCadence && isOneShotCron(String(original.schedule)) ? { ...original, isActive: false } : original;
    if (!current || current.ownerUserId !== owner || (current.taskRunId ?? null) !== expectedRunId
      || (current.nextRunAt?.getTime() ?? null) !== (original.nextRunAt instanceof Date ? original.nextRunAt.getTime() : null)
      || scheduledReportingScopeDigest(current) !== scheduledReportingScopeDigest(expected)) return null;
    if (requireWorking) {
      if (!expectedRunId) return null;
      const run = await tx.taskRun.findUnique({ where: { taskRunId: expectedRunId }, select: { userId: true, status: true } });
      if (!run || run.userId !== owner || run.status !== "working") return null;
    }
    return write(tx);
  }, { maxWait: 5000, timeout: 20000 });
}

/**
 * Existing generic cadence admission (BI-D1CD3A11). Only one caller advances
 * a due tick. One-shot tasks deactivate rather than re-arm (BI-D72CC945).
 * Acceptance uses its separately fenced lease, never this cadence claim.
 */
export async function claimScheduledTaskCadence(
  db: Pick<typeof prisma, "$transaction">,
  task: Record<string, unknown> & { taskId: string; ownerUserId: string; schedule: string; taskRunId?: string | null },
  now = new Date(),
): Promise<boolean> {
  const oneShot = isOneShotCron(task.schedule);
  const nextRunAt = oneShot ? null : computeNextCronRun(task.schedule, now);
  const won = await withCurrentScheduledTask(db, task, task.taskRunId ?? null, async tx => {
  const claim = await tx.scheduledAgentTask.updateMany({
    where: { taskId: task.taskId, isActive: true, nextRunAt: { lte: now } },
    data: oneShot ? { nextRunAt: null, isActive: false } : { nextRunAt },
  });
  if (claim.count === 0) return false;
  await tx.scheduledJob.updateMany({ where: { jobId: task.taskId }, data: { nextRunAt } });
  return true;
  }, false, true) ?? false;
  // Keep this invocation's committed cadence token for binding and settlement;
  // a later explicit rerun changes it and cannot be overwritten by this run.
  if (won) task.nextRunAt = nextRunAt;
  return won;
}
