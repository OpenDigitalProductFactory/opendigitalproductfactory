import {
  Prisma,
  prisma,
} from "@dpf/db";

import { computeNextCronRun, isOneShotCron } from "@/lib/operate/cron-next-run";
import { createTaskRunForScheduledTask, type ScheduledTaskRunRef } from "@/lib/tak/scheduled-task-runs";

import { evaluateBusinessAnalysisWatchTask } from "./business-analysis-watch.server";

type BusinessAnalysisWatchScheduledTask = Parameters<typeof evaluateBusinessAnalysisWatchTask>[0] & {
  taskId: string;
  schedule: string;
  agentId: string;
  routeContext: string;
  title: string;
  prompt: string;
};

export async function executeBusinessAnalysisWatchRun(
  task: BusinessAnalysisWatchScheduledTask,
): Promise<void> {
  const startedAt = new Date();
  const oneShot = isOneShotCron(task.schedule);
  const nextRunAt = oneShot ? null : computeNextCronRun(task.schedule, startedAt);
  let runRef: ScheduledTaskRunRef | null = null;

  try {
    const contextKey = `scheduled:${task.taskId}`;
    const thread = await prisma.agentThread.upsert({
      where: { userId_contextKey: { userId: task.ownerUserId, contextKey } },
      update: {},
      create: { userId: task.ownerUserId, contextKey },
    });
    runRef = await createTaskRunForScheduledTask({
      taskId: task.taskId,
      ownerUserId: task.ownerUserId,
      agentId: task.agentId,
      threadId: thread.id,
      routeContext: task.routeContext,
      title: task.title,
      prompt: task.prompt,
    });
    const result = await evaluateBusinessAnalysisWatchTask(task);
    await prisma.taskRun.update({
      where: { id: runRef.id },
      data: {
        status: "completed",
        completedAt: startedAt,
        progressPayload: {
          kind: "business-analysis-watch",
          evaluation: result.evaluation,
        },
      },
    });
    await prisma.scheduledAgentTask.update({
      where: { taskId: task.taskId },
      data: {
        taskConfig: result.nextConfig as unknown as Prisma.InputJsonValue,
        taskRunId: runRef.taskRunId,
        lastRunAt: startedAt,
        lastStatus: result.evaluation.status,
        lastError: null,
        nextRunAt,
        ...(oneShot ? { isActive: false } : {}),
      },
    });
    await prisma.scheduledJob.update({
      where: { jobId: task.taskId },
      data: {
        lastRunAt: startedAt,
        lastStatus: result.evaluation.status,
        lastError: null,
        nextRunAt,
        ...(oneShot ? { schedule: "disabled" } : {}),
      },
    }).catch(() => {});
  } catch (error) {
    const message = error instanceof Error ? error.message : "unknown error";
    if (runRef) {
      await prisma.taskRun.update({
        where: { id: runRef.id },
        data: {
          status: "failed",
          completedAt: startedAt,
          progressPayload: { kind: "business-analysis-watch", error: message },
        },
      }).catch(() => {});
    }
    await prisma.scheduledAgentTask.update({
      where: { taskId: task.taskId },
      data: {
        taskRunId: runRef?.taskRunId ?? null,
        lastRunAt: startedAt,
        lastStatus: "error",
        lastError: message,
        nextRunAt,
        ...(oneShot ? { isActive: false } : {}),
      },
    });
    await prisma.scheduledJob.update({
      where: { jobId: task.taskId },
      data: {
        lastRunAt: startedAt,
        lastStatus: "error",
        lastError: message,
        nextRunAt,
        ...(oneShot ? { schedule: "disabled" } : {}),
      },
    }).catch(() => {});
  }
}
