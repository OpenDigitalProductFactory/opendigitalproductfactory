// The deterministic executor for the daily `demand-scoring-steward` scheduled
// task (BI-00C68162). Extracted so the dispatcher stays a thin discriminator,
// mirroring executeDecisionEngineReviewTask.
//
// Off the LLM path: it reads backlog signals, runs the pure proposer, and writes
// agent-proposed scores. Re-running a tick is safe — an item scored by an
// earlier run is no longer eligible, so a retry simply takes the next batch.

import { prisma } from "@dpf/db";

import { computeNextCronRun } from "@/lib/operate/cron-next-run";
import { queueProductManagementPlaybookRefreshForBacklogItem } from "@/lib/product-management/product-management-playbook-refresh";

import {
  resolveStewardBatchSize,
  runDemandScoringSteward,
  type DemandStewardDb,
  type DemandStewardResult,
} from "./scoring-steward";

/** The scheduled-task fields this branch reads. */
export interface DemandScoringStewardTask {
  taskId: string;
  schedule: string;
  agentId: string;
  taskConfig?: unknown;
}

/** One line for the schedule surface: what moved, and what is left. */
export function describeStewardRun(result: DemandStewardResult): string {
  const parts = [
    `${result.scored.length} proposed`,
    `${result.unscoredRemaining} unscored remaining`,
  ];
  if (result.noEffortSignal.length) parts.push(`${result.noEffortSignal.length} need an effort size`);
  if (result.raced.length) parts.push(`${result.raced.length} changed by an owner mid-run`);
  return parts.join("; ");
}

export async function executeDemandScoringStewardTask(
  task: DemandScoringStewardTask,
  deps: { now?: Date } = {},
): Promise<void> {
  const startedAt = deps.now ?? new Date();
  const nextRunAt = computeNextCronRun(task.schedule, startedAt);
  try {
    const result = await runDemandScoringSteward(prisma as unknown as DemandStewardDb, {
      agentId: task.agentId,
      taskId: task.taskId,
      batchSize: resolveStewardBatchSize(task.taskConfig),
      now: startedAt,
      onScored: (itemId) =>
        queueProductManagementPlaybookRefreshForBacklogItem({ itemId, changedAt: startedAt }),
    });
    const summary = describeStewardRun(result);
    console.info("[demand-scoring-steward] %s", summary);
    await prisma.scheduledAgentTask.update({
      where: { taskId: task.taskId },
      data: { lastRunAt: startedAt, lastStatus: "ok", lastError: null, nextRunAt },
    });
    await prisma.scheduledJob
      .update({
        where: { jobId: task.taskId },
        data: { lastRunAt: startedAt, lastStatus: "ok", lastError: null, lastRunSummary: summary, nextRunAt },
      })
      .catch(() => {});
  } catch (err) {
    const message = err instanceof Error ? err.message : "unknown error";
    await prisma.scheduledAgentTask.update({
      where: { taskId: task.taskId },
      data: { lastRunAt: startedAt, lastStatus: "error", lastError: message, nextRunAt },
    });
    await prisma.scheduledJob
      .update({
        where: { jobId: task.taskId },
        data: { lastRunAt: startedAt, lastStatus: "error", lastError: message, nextRunAt },
      })
      .catch(() => {});
  }
}
