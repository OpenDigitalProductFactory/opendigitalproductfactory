"use server";

import { auth } from "@/lib/auth";
import { prisma } from "@dpf/db";
import { randomUUID } from "crypto";
import { extractScheduledTaskSummary } from "./agent-task-scheduler-summary";
import {
  createTaskRunForScheduledTask,
  type ScheduledTaskRunRef,
} from "@/lib/tak/scheduled-task-runs";
import { createTaskMessage } from "@/lib/tak/task-records";
import {
  executeAutonomousAgenticLoop,
  executeAutonomousWorkTool,
  resolveAutonomousWorkAgent,
  resolveAutonomousWorkTools,
} from "@/lib/tak/autonomous-work-run";

// ─── Cron helpers ───────────────────────────────────────────────────────────

/**
 * Compute the next run time from a cron expression.
 * Supports standard 5-field cron: minute hour day-of-month month day-of-week
 * For simplicity, handles the common patterns directly.
 */
function computeNextCronRun(cronExpr: string, from: Date): Date {
  const parts = cronExpr.trim().split(/\s+/);
  if (parts.length !== 5) return new Date(from.getTime() + 24 * 60 * 60_000); // fallback daily

  const [minPart, hourPart, , , dowPart] = parts;
  const minute = minPart === "*" ? 0 : parseInt(minPart!, 10);
  const hour = hourPart === "*" ? from.getHours() : parseInt(hourPart!, 10);

  // Start from the next hour boundary
  const next = new Date(from);
  next.setSeconds(0, 0);
  next.setMinutes(minute);
  next.setHours(hour);

  // If time already passed today, go to tomorrow
  if (next <= from) {
    next.setDate(next.getDate() + 1);
  }

  // Handle day-of-week constraint
  if (dowPart && dowPart !== "*") {
    const targetDays = dowPart.split(",").map((d) => parseInt(d, 10));
    let safety = 0;
    while (!targetDays.includes(next.getDay()) && safety < 8) {
      next.setDate(next.getDate() + 1);
      safety++;
    }
  }

  return next;
}

function getRequiredProceduralToolForScheduledTask(taskId: string): {
  name: string;
  args: Record<string, unknown>;
} | null {
  if (taskId === "discovery-taxonomy-gap-triage-daily") {
    return {
      name: "run_discovery_triage",
      args: { trigger: "cadence" },
    };
  }

  return null;
}

// ─── Public actions ─────────────────────────────────────────────────────────

export type ScheduleAgentTaskInput = {
  agentId: string;
  title: string;
  prompt: string;
  routeContext: string;
  schedule: string; // cron expression
  timezone?: string;
};

export async function scheduleAgentTask(
  input: ScheduleAgentTaskInput,
): Promise<{ success: true; taskId: string } | { success: false; error: string }> {
  const session = await auth();
  if (!session?.user?.id) return { success: false, error: "Unauthorized" };

  if (input.timezone && input.timezone !== "UTC") {
    return {
      success: false,
      error: "Non-UTC timezones are not yet supported. All schedules run in UTC.",
    };
  }

  const taskId = `agent-task-${randomUUID().slice(0, 8)}`;
  const now = new Date();
  const nextRunAt = computeNextCronRun(input.schedule, now);

  await prisma.scheduledAgentTask.create({
    data: {
      taskId,
      agentId: input.agentId,
      title: input.title,
      prompt: input.prompt,
      routeContext: input.routeContext,
      schedule: input.schedule,
      timezone: input.timezone ?? "UTC",
      ownerUserId: session.user.id,
      nextRunAt,
    },
  });

  // Also register as ScheduledJob so it appears in calendar projections
  await prisma.scheduledJob.upsert({
    where: { jobId: taskId },
    create: {
      jobId: taskId,
      name: `Agent: ${input.title}`,
      schedule: input.schedule,
      nextRunAt,
    },
    update: {
      name: `Agent: ${input.title}`,
      schedule: input.schedule,
      nextRunAt,
    },
  });

  return { success: true, taskId };
}

export async function cancelAgentTask(
  taskId: string,
): Promise<{ success: boolean; error?: string }> {
  const session = await auth();
  if (!session?.user?.id) return { success: false, error: "Unauthorized" };

  await prisma.scheduledAgentTask.update({
    where: { taskId },
    data: { isActive: false },
  });

  await prisma.scheduledJob.update({
    where: { jobId: taskId },
    data: { schedule: "disabled" },
  }).catch(() => {});

  return { success: true };
}

export async function getScheduledAgentTasks(): Promise<
  Array<{
    taskId: string;
    agentId: string;
    title: string;
    prompt: string;
    schedule: string;
    isActive: boolean;
    nextRunAt: string | null;
    lastRunAt: string | null;
    lastStatus: string | null;
  }>
> {
  const session = await auth();
  if (!session?.user?.id) return [];

  const tasks = await prisma.scheduledAgentTask.findMany({
    where: { ownerUserId: session.user.id },
    orderBy: { createdAt: "desc" },
    select: {
      taskId: true,
      agentId: true,
      title: true,
      prompt: true,
      schedule: true,
      isActive: true,
      nextRunAt: true,
      lastRunAt: true,
      lastStatus: true,
    },
  });

  return tasks.map((t) => ({
    ...t,
    nextRunAt: t.nextRunAt?.toISOString() ?? null,
    lastRunAt: t.lastRunAt?.toISOString() ?? null,
  }));
}

// ─── Execution (called by Inngest dispatcher) ───────────────────────────────

export async function executeScheduledAgentTask(taskId: string): Promise<void> {
  const task = await prisma.scheduledAgentTask.findUnique({
    where: { taskId },
  });
  if (!task || !task.isActive) return;

  const now = new Date();
  let taskRunRef: ScheduledTaskRunRef | null = null;

  try {
    // Get or create a dedicated thread for this scheduled task
    const contextKey = `scheduled:${taskId}`;
    const thread = await prisma.agentThread.upsert({
      where: { userId_contextKey: { userId: task.ownerUserId, contextKey } },
      update: {},
      create: { userId: task.ownerUserId, contextKey },
    });

    // Persist the user prompt as a message
    await prisma.agentMessage.create({
      data: {
        threadId: thread.id,
        role: "user",
        content: `[Scheduled task: ${task.title}]\n\n${task.prompt}`,
        agentId: task.agentId,
        routeContext: task.routeContext,
      },
    });

    taskRunRef = await createTaskRunForScheduledTask({
      taskId: task.taskId,
      ownerUserId: task.ownerUserId,
      agentId: task.agentId,
      threadId: thread.id,
      routeContext: task.routeContext,
      title: task.title,
      prompt: task.prompt,
    });

    await createTaskMessage({
      taskRunId: taskRunRef.taskRunId,
      taskRunRecordId: taskRunRef.id,
      contextId: taskRunRef.contextId,
      role: "user",
      content: `[Scheduled task: ${task.title}]\n\n${task.prompt}`,
      metadata: {
        source: "scheduled",
        taskId: task.taskId,
        routeContext: task.routeContext,
      },
    });

    // Look up owner's role for permission context
    const owner = await prisma.user.findUnique({
      where: { id: task.ownerUserId },
      select: { id: true, isSuperuser: true },
    });
    const userContext = {
      userId: task.ownerUserId,
      platformRole: null as string | null,
      isSuperuser: owner?.isSuperuser ?? false,
    };

    const agentInfo = await resolveAutonomousWorkAgent({
      agentId: task.agentId,
      routeContext: task.routeContext,
      userContext,
    });

    const scheduledPrompt = `[Scheduled task: ${task.title}]\n\n${task.prompt}`;
    const chatHistory = [
      {
        role: "user" as const,
        content: scheduledPrompt,
      },
    ];

    const { tools, toolsForProvider } = await resolveAutonomousWorkTools({
      userContext,
      mode: "act",
      agentId: task.agentId,
    });

    const result = await executeAutonomousAgenticLoop({
      systemPrompt: agentInfo.systemPrompt,
      chatHistory,
      sensitivity: agentInfo.sensitivity ?? "internal",
      tools,
      toolsForProvider,
      userId: task.ownerUserId,
      routeContext: task.routeContext,
      agentId: task.agentId,
      threadId: thread.id,
      taskRunId: taskRunRef.taskRunId,
    });
    const executedTools = [...(result.executedTools ?? [])];

    const requiredTool = getRequiredProceduralToolForScheduledTask(task.taskId);
    if (requiredTool) {
      const hasPersistedRequiredTool = await prisma.toolExecution.findFirst({
        where: {
          taskRunId: taskRunRef.taskRunId,
          toolName: requiredTool.name,
          success: true,
        },
        select: { id: true },
      });

      if (!hasPersistedRequiredTool) {
        const alreadyCountedRequiredTool = executedTools.some(
          (tool) => tool.name === requiredTool.name,
        );
        const toolResult = await executeAutonomousWorkTool({
          toolName: requiredTool.name,
          args: requiredTool.args,
          userId: task.ownerUserId,
          userContext,
          routeContext: task.routeContext,
          agentId: task.agentId,
          threadId: thread.id,
          taskRunId: taskRunRef.taskRunId,
        });
        if (!alreadyCountedRequiredTool) {
          executedTools.push({
            name: requiredTool.name,
            args: requiredTool.args,
            result: toolResult,
          });
        }
      }
    }

    const scheduledSummary = extractScheduledTaskSummary(executedTools);
    const taskMessageContent = scheduledSummary?.compactStatus ?? result.content ?? "(No response)";

    // Persist agent response
    await prisma.agentMessage.create({
      data: {
        threadId: thread.id,
        role: "assistant",
        content: result.content ?? "(No response)",
        agentId: task.agentId,
        routeContext: task.routeContext,
      },
    });

    await createTaskMessage({
      taskRunId: taskRunRef.taskRunId,
      taskRunRecordId: taskRunRef.id,
      contextId: taskRunRef.contextId,
      role: "agent",
      content: taskMessageContent,
      metadata: {
        source: "scheduled",
        taskId: task.taskId,
        agentId: task.agentId,
      },
    });

    if (scheduledSummary) {
      await prisma.agentMessage.create({
        data: {
          threadId: thread.id,
          role: "assistant",
          content: scheduledSummary.threadMessage,
          agentId: task.agentId,
          routeContext: task.routeContext,
          taskType: "scheduled-task-summary",
        },
      });
    }

    // Update task status and schedule next run
    const nextRunAt = computeNextCronRun(task.schedule, now);
    await prisma.scheduledAgentTask.update({
      where: { taskId },
      data: {
        lastRunAt: now,
        lastStatus: "ok",
        lastError: null,
        lastThreadId: thread.id,
        taskRunId: taskRunRef.taskRunId,
        nextRunAt,
      },
    });

    await prisma.taskRun.update({
      where: { id: taskRunRef.id },
      data: {
        status: "completed",
        completedAt: new Date(),
        progressPayload: {
          scheduledSummary: scheduledSummary?.compactStatus ?? null,
          scheduledSummaryPayload: scheduledSummary?.payload ?? null,
          executedToolCount: executedTools.length,
        },
      },
    });

    await prisma.scheduledJob.update({
      where: { jobId: taskId },
      data: {
        lastRunAt: now,
        lastStatus: "ok",
        lastError: null,
        nextRunAt,
      },
    }).catch(() => {});

  } catch (err) {
    const errMsg = err instanceof Error ? err.message : "unknown error";
    // CodeQL #39 (js/tainted-format-string): taskId via format-arg.
    console.error("[agent-task-scheduler] Task %s failed:", taskId, errMsg);

    const ref = taskRunRef;
    if (ref) {
      await prisma.taskRun.update({
        where: { id: ref.id },
        data: {
          status: "failed",
          completedAt: new Date(),
          progressPayload: {
            error: errMsg,
          },
        },
      }).catch((updateErr) => {
        console.error(
          `[agent-task-scheduler] Failed to mark TaskRun ${ref.taskRunId} failed:`,
          updateErr,
        );
      });
    }

    const nextRunAt = computeNextCronRun(task.schedule, now);
    await prisma.scheduledAgentTask.update({
      where: { taskId },
      data: {
        lastRunAt: now,
        lastStatus: "error",
        lastError: errMsg,
        taskRunId: taskRunRef?.taskRunId ?? null,
        nextRunAt,
      },
    });

    await prisma.scheduledJob.update({
      where: { jobId: taskId },
      data: { lastRunAt: now, lastStatus: "error", lastError: errMsg, nextRunAt },
    }).catch(() => {});
  }
}
