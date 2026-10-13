import type { prisma } from "@dpf/db";
import { computeNextCronRun, isOneShotCron } from "@/lib/operate/cron-next-run";

/**
 * Existing generic cadence admission (BI-D1CD3A11). Only one caller advances
 * a due tick. One-shot tasks deactivate rather than re-arm (BI-D72CC945).
 * Acceptance uses its separately fenced lease, never this cadence claim.
 */
export async function claimScheduledTaskCadence(
  db: Pick<typeof prisma, "scheduledAgentTask" | "scheduledJob">,
  task: { taskId: string; schedule: string },
  now = new Date(),
): Promise<boolean> {
  const oneShot = isOneShotCron(task.schedule);
  const nextRunAt = oneShot ? null : computeNextCronRun(task.schedule, now);
  const claim = await db.scheduledAgentTask.updateMany({
    where: { taskId: task.taskId, isActive: true, nextRunAt: { lte: now } },
    data: oneShot ? { nextRunAt: null, isActive: false } : { nextRunAt },
  });
  if (claim.count === 0) return false;
  await db.scheduledJob.updateMany({ where: { jobId: task.taskId }, data: { nextRunAt } }).catch(() => {});
  return true;
}
