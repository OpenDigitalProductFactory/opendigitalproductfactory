import { randomUUID } from "crypto";
import { prisma } from "@dpf/db";

export type ScheduledTaskRunRef = {
  id: string;
  taskRunId: string;
  contextId: string | null;
};

export async function createTaskRunForScheduledTask(input: {
  taskId: string;
  ownerUserId: string;
  agentId: string;
  threadId: string;
  routeContext: string;
  title: string;
  prompt: string;
}): Promise<ScheduledTaskRunRef> {
  const taskRunId = `TR-SCHED-${randomUUID().slice(0, 8).toUpperCase()}`;

  return prisma.taskRun.create({
    data: {
      taskRunId,
      userId: input.ownerUserId,
      threadId: input.threadId,
      contextId: input.threadId,
      initiatingAgentId: input.agentId,
      currentAgentId: input.agentId,
      routeContext: input.routeContext,
      title: input.title,
      objective: input.prompt.slice(0, 1000),
      source: "proactive",
      status: "working",
      authorityScope: [],
      a2aMetadata: {
        trigger: "scheduled",
        sourceRef: {
          kind: "scheduled-task",
          id: input.taskId,
        },
      },
    },
    select: { id: true, taskRunId: true, contextId: true },
  });
}
