// S-TRIG (BI-DC738330) — the deterministic executor for the weekly `bookkeeping-cycle`
// scheduled task. Extracted from agent-task-scheduler.ts so the dispatcher stays a thin
// discriminator (mirrors executeBusinessAnalysisWatchRun). Opens or advances the standing
// Bookkeeping Work Room's cycle for the current period, off the LLM path; idempotent per week.
import { prisma } from "@dpf/db";

import { computeNextCronRun } from "@/lib/operate/cron-next-run";

import { bookkeepingPeriodKey, openOrAdvanceBookkeepingPeriod } from "./bookkeeping-period-room";

/** The scheduled-task fields this deterministic branch reads. */
export interface BookkeepingCycleTask {
  taskId: string;
  schedule: string;
  ownerUserId: string;
  agentId: string;
}

export async function executeBookkeepingCycleTask(task: BookkeepingCycleTask): Promise<void> {
  const startedAt = new Date();
  try {
    const periodKey = bookkeepingPeriodKey(startedAt);
    const result = await openOrAdvanceBookkeepingPeriod({
      periodKey,
      trigger: "Weekly bookkeeping cadence fired.",
      accountablePrincipalRef: `prn:user:${task.ownerUserId}`,
      actor: { type: "agent", id: task.agentId },
      now: startedAt,
    });
    console.info(
      "[agent-task-scheduler] bookkeeping cycle %s (opened=%s, idempotent=%s, alreadyActive=%s)",
      result.cycleKey,
      result.opened,
      result.idempotent,
      result.alreadyActive,
    );
    const nextRunAt = computeNextCronRun(task.schedule, startedAt);
    await prisma.scheduledAgentTask.update({
      where: { taskId: task.taskId },
      data: { lastRunAt: startedAt, lastStatus: "ok", lastError: null, nextRunAt },
    });
    await prisma.scheduledJob
      .update({ where: { jobId: task.taskId }, data: { lastRunAt: startedAt, lastStatus: "ok", lastError: null, nextRunAt } })
      .catch(() => {});
  } catch (err) {
    const errMsg = err instanceof Error ? err.message : "unknown error";
    const nextRunAt = computeNextCronRun(task.schedule, startedAt);
    await prisma.scheduledAgentTask.update({
      where: { taskId: task.taskId },
      data: { lastRunAt: startedAt, lastStatus: "error", lastError: errMsg, nextRunAt },
    });
    await prisma.scheduledJob
      .update({ where: { jobId: task.taskId }, data: { lastRunAt: startedAt, lastStatus: "error", lastError: errMsg, nextRunAt } })
      .catch(() => {});
  }
}
