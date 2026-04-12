import { cron } from "inngest";
import { inngest } from "../inngest-client";

/**
 * Polls ScheduledAgentTask every 5 minutes and dispatches due tasks.
 * Each due task gets its own Inngest step so failures are isolated.
 */
export const agentTaskDispatch = inngest.createFunction(
  {
    id: "agent/task-dispatch",
    retries: 1,
    concurrency: { limit: 1, scope: "fn" },
    triggers: [cron("*/5 * * * *")],
  },
  async ({ step }) => {
    const dueTaskIds = await step.run("find-due-tasks", async () => {
      const { prisma } = await import("@dpf/db");
      const now = new Date();

      const tasks: Array<{ taskId: string }> = await prisma.scheduledAgentTask.findMany({
        where: {
          isActive: true,
          nextRunAt: { lte: now },
        },
        select: { taskId: true },
        take: 20,
      });

      return tasks.map((t: { taskId: string }) => t.taskId);
    });

    if (dueTaskIds.length === 0) return { dispatched: 0 };

    let dispatched = 0;
    for (const taskId of dueTaskIds) {
      await step.run(`dispatch-${taskId}`, async () => {
        const { executeScheduledAgentTask } = await import(
          "@/lib/actions/agent-task-scheduler"
        );
        await executeScheduledAgentTask(taskId);
        dispatched++;
      });
    }

    return { dispatched };
  },
);
