import { inngest } from "../inngest-client";
import { buildPipelineConcurrency } from "../admission";
import { gateBetweenSteps, type GateBetweenStepsRunner } from "../quiescence-gates";

export const mcpTaskExecute = inngest.createFunction(
  {
    id: "mcp/task.execute",
    retries: 2,
    concurrency: buildPipelineConcurrency({ key: "event.data.taskRunId", limit: 1 }),
    triggers: [{ event: "mcp/task.execute" }],
    onFailure: async ({ event, error }) => {
      const original = (event.data as { event?: { data?: { taskRunId?: string } } }).event;
      const taskRunId = original?.data?.taskRunId;
      if (!taskRunId) return;
      const { prisma } = await import("@dpf/db");
      await prisma.taskRun.updateMany({
        where: {
          taskRunId,
          status: { notIn: ["completed", "failed", "canceled", "rejected", "archived"] },
          cancellationRequestedAt: null,
        },
        data: {
          status: "failed",
          completedAt: new Date(),
          progressPayload: {
            summary: error instanceof Error ? error.message.slice(0, 4_000) : "MCP task worker failed",
          },
        },
      }).catch(() => {});
    },
  },
  async ({ event, step }) => {
    await gateBetweenSteps(step as unknown as GateBetweenStepsRunner, "mcp-task-entry");
    const taskRunId = event.data.taskRunId as string;
    await step.run("execute", async () => {
      const { executeRemoteTask } = await import("@/lib/mcp/remote-task-executor");
      await executeRemoteTask(taskRunId);
    });
    return { taskRunId };
  },
);
