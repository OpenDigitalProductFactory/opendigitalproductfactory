// Scheduled-agent-task management core (BI-1C44A93A).
//
// The create / list / cancel logic for recurring agent tasks lives here,
// EXPLICITLY userId-parameterized and NOT marked "use server", so it can be
// shared by two callers with different identity sources without either letting a
// caller spoof a user:
//   - the web server actions (apps/web/lib/actions/agent-task-scheduler.ts)
//     resolve userId from auth() and delegate here;
//   - the MCP tools (apps/web/lib/mcp-tools.ts) pass the MCP-authenticated
//     userId (the tool layer already gated scope + grants).
// A "use server" file exports only client-callable actions, so a userId
// parameter there would be client-spoofable — hence this separate core.

import { prisma } from "@dpf/db";
import { randomUUID } from "crypto";
import { SCHEDULING_MAP } from "@/lib/operate/scheduled-jobs/scheduling-map";
import { occupiedTicks, deconflictCron } from "@/lib/operate/scheduled-jobs/scheduling-allocator";
import { computeNextCronRun } from "@/lib/operate/cron-next-run";

export type ScheduleAgentTaskInput = {
  agentId: string;
  title: string;
  prompt: string;
  routeContext: string;
  /** Cron expression (5-field). */
  schedule: string;
  timezone?: string;
};

export type ScheduleAgentTaskResult =
  | { success: true; taskId: string; note?: string }
  | { success: false; error: string };

export type ScheduledAgentTaskView = {
  taskId: string;
  agentId: string;
  title: string;
  prompt: string;
  schedule: string;
  isActive: boolean;
  nextRunAt: string | null;
  lastRunAt: string | null;
  lastStatus: string | null;
};

/**
 * Create a recurring agent task owned by `userId`. De-conflicts the cron tick at
 * creation (BI-SCHED-ALLOCATE) and registers a mirror ScheduledJob row so the
 * task shows up in calendar projections. Caller is responsible for authorizing
 * `userId` (auth() in the web action; scope+grant gate in the MCP tool).
 */
export async function scheduleAgentTaskFor(
  userId: string,
  input: ScheduleAgentTaskInput,
): Promise<ScheduleAgentTaskResult> {
  if (input.timezone && input.timezone !== "UTC") {
    return {
      success: false,
      error: "Non-UTC timezones are not yet supported. All schedules run in UTC.",
    };
  }

  const taskId = `agent-task-${randomUUID().slice(0, 8)}`;
  const now = new Date();

  // De-conflict at creation so a new task does not pile onto a tick already in
  // use (canonical scheduling map + other live agent tasks). Interval cadences
  // pass through untouched.
  const liveTasks = await prisma.scheduledAgentTask.findMany({
    where: { isActive: true },
    select: { schedule: true },
  });
  const occupied = occupiedTicks([
    ...SCHEDULING_MAP.map((e) => e.cron),
    ...liveTasks.map((t) => t.schedule),
  ]);
  const { cron: schedule, note } = deconflictCron(input.schedule, occupied);

  const nextRunAt = computeNextCronRun(schedule, now);

  await prisma.scheduledAgentTask.create({
    data: {
      taskId,
      agentId: input.agentId,
      title: input.title,
      prompt: input.prompt,
      routeContext: input.routeContext,
      schedule,
      timezone: input.timezone ?? "UTC",
      ownerUserId: userId,
      nextRunAt,
    },
  });

  // Mirror as a ScheduledJob so it appears in calendar projections.
  await prisma.scheduledJob.upsert({
    where: { jobId: taskId },
    create: { jobId: taskId, name: `Agent: ${input.title}`, schedule, nextRunAt },
    update: { name: `Agent: ${input.title}`, schedule, nextRunAt },
  });

  return note ? { success: true, taskId, note } : { success: true, taskId };
}

/** List the recurring agent tasks owned by `userId`, newest first. */
export async function getScheduledAgentTasksFor(userId: string): Promise<ScheduledAgentTaskView[]> {
  const tasks = await prisma.scheduledAgentTask.findMany({
    where: { ownerUserId: userId },
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

/**
 * Deactivate a recurring agent task. Ownership-checked: only the owning `userId`
 * may cancel it (so an MCP caller cannot cancel another user's task by id).
 */
export async function cancelAgentTaskFor(
  userId: string,
  taskId: string,
): Promise<{ success: boolean; error?: string }> {
  const task = await prisma.scheduledAgentTask.findUnique({
    where: { taskId },
    select: { ownerUserId: true },
  });
  if (!task) return { success: false, error: "Scheduled agent task not found" };
  if (task.ownerUserId !== userId) {
    return { success: false, error: "Not authorized to cancel this scheduled agent task" };
  }

  await prisma.scheduledAgentTask.update({
    where: { taskId },
    data: { isActive: false },
  });
  await prisma.scheduledJob
    .update({ where: { jobId: taskId }, data: { schedule: "disabled" } })
    .catch(() => {});

  return { success: true };
}
