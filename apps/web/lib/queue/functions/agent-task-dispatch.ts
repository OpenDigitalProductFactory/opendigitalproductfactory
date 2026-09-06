import { cron } from "inngest";
import { inngest } from "../inngest-client";
import { gateAtEntry } from "../quiescence-gates";
import { buildPipelineConcurrency } from "../admission";

/**
 * Polls ScheduledAgentTask every 5 minutes and dispatches due tasks.
 * Each due task gets its own Inngest step so failures are isolated.
 */
export const agentTaskDispatch = inngest.createFunction(
  {
    id: "agent/task-dispatch",
    retries: 1,
    concurrency: buildPipelineConcurrency({ limit: 1, scope: "fn" }),
    triggers: [cron("*/5 * * * *")],
  },
  async ({ step }) => {
    const gate = await gateAtEntry(step, "agent/task-dispatch");
    if (!gate.proceed) return { skipped: true, reason: gate.reason };

    // Once an hour (on the top-of-hour :00 tick of this */5 poll), converge every
    // coworker self-task with its owner's Proactivity toggle so the two can't
    // silently desync — create tasks for coworkers turned up before they were
    // registered, stand down quiet ones, and restore a toggle from an orphaned
    // task (BI-E962B9CD). Cheap, non-destructive DB reconcile; isolated in its
    // own step so a hiccup never blocks dispatch.
    await step.run("reconcile-coworker-self-tasks-hourly", async () => {
      const now = new Date();
      if (now.getUTCMinutes() >= 5) return { skipped: true };
      const { reconcileAllCoworkerSelfTasks } = await import(
        "@/lib/operate/scheduled-jobs/coworker-self-tasks"
      );
      return reconcileAllCoworkerSelfTasks();
    });

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
