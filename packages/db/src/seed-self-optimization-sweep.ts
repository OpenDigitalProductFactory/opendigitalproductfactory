// Self-optimization engine: seed the weekly consolidation sweep scheduled
// task. The deterministic handler lives in apps/web's scheduler
// (executeScheduledAgentTask early-branches on this task id and runs
// runSelfOptimizationSweep without an LLM loop). Mirrors
// seed-sysml-projection.ts.
import type { PrismaClient } from "../generated/client/client";

import {
  SELF_OPTIMIZATION_SWEEP_AGENT_ID,
  SELF_OPTIMIZATION_SWEEP_DEFAULT_TIMEZONE,
  SELF_OPTIMIZATION_SWEEP_PROMPT,
  SELF_OPTIMIZATION_SWEEP_ROUTE_CONTEXT,
  SELF_OPTIMIZATION_SWEEP_SCHEDULE,
  SELF_OPTIMIZATION_SWEEP_SCHEDULED_JOB_NAME,
  SELF_OPTIMIZATION_SWEEP_TASK_ID,
  SELF_OPTIMIZATION_SWEEP_TASK_TITLE,
} from "./self-optimization-sweep-config";

type ScheduledTaskSeedClient = Pick<PrismaClient, "user" | "scheduledAgentTask" | "scheduledJob">;

function computeNextWeeklyRun(cronExpr: string, from: Date): Date {
  const parts = cronExpr.trim().split(/\s+/);
  const fallback = () => {
    const next = new Date(from);
    next.setUTCDate(next.getUTCDate() + 7);
    return next;
  };
  if (parts.length !== 5) return fallback();
  const [minPart, hourPart, , , dowPart] = parts;
  const minute = minPart === "*" ? 0 : parseInt(minPart!, 10);
  const hour = hourPart === "*" ? 0 : parseInt(hourPart!, 10);
  const dow = dowPart === "*" ? from.getUTCDay() : parseInt(dowPart!, 10);
  if ([minute, hour, dow].some((value) => Number.isNaN(value))) return fallback();
  const next = new Date(from);
  next.setUTCSeconds(0, 0);
  next.setUTCMinutes(minute);
  next.setUTCHours(hour);
  const dayDelta = (dow - next.getUTCDay() + 7) % 7;
  next.setUTCDate(next.getUTCDate() + dayDelta);
  if (next <= from) next.setUTCDate(next.getUTCDate() + 7);
  return next;
}

export async function ensureSelfOptimizationSweepScheduledTask(
  prisma: ScheduledTaskSeedClient,
  now: Date = new Date(),
): Promise<{ created: boolean }> {
  const owner = await prisma.user.findFirst({
    where: { isSuperuser: true },
    orderBy: { createdAt: "asc" },
    select: { id: true },
  });
  if (!owner) {
    throw new Error("seed: no superuser found - cannot seed self-optimization sweep scheduled task");
  }

  const timezone = process.env.INSTALL_TIMEZONE ?? SELF_OPTIMIZATION_SWEEP_DEFAULT_TIMEZONE;
  const nextRunAt = computeNextWeeklyRun(SELF_OPTIMIZATION_SWEEP_SCHEDULE, now);

  const existing = await prisma.scheduledAgentTask.findUnique({
    where: { taskId: SELF_OPTIMIZATION_SWEEP_TASK_ID },
    select: { taskId: true, nextRunAt: true },
  });

  if (existing) {
    await prisma.scheduledAgentTask.update({
      where: { taskId: SELF_OPTIMIZATION_SWEEP_TASK_ID },
      data: {
        agentId: SELF_OPTIMIZATION_SWEEP_AGENT_ID,
        title: SELF_OPTIMIZATION_SWEEP_TASK_TITLE,
        prompt: SELF_OPTIMIZATION_SWEEP_PROMPT,
        routeContext: SELF_OPTIMIZATION_SWEEP_ROUTE_CONTEXT,
        schedule: SELF_OPTIMIZATION_SWEEP_SCHEDULE,
        timezone,
        ownerUserId: owner.id,
        isActive: true,
        nextRunAt: existing.nextRunAt ?? nextRunAt,
      },
    });
  } else {
    await prisma.scheduledAgentTask.create({
      data: {
        taskId: SELF_OPTIMIZATION_SWEEP_TASK_ID,
        agentId: SELF_OPTIMIZATION_SWEEP_AGENT_ID,
        title: SELF_OPTIMIZATION_SWEEP_TASK_TITLE,
        prompt: SELF_OPTIMIZATION_SWEEP_PROMPT,
        routeContext: SELF_OPTIMIZATION_SWEEP_ROUTE_CONTEXT,
        schedule: SELF_OPTIMIZATION_SWEEP_SCHEDULE,
        timezone,
        ownerUserId: owner.id,
        nextRunAt,
      },
    });
  }

  await prisma.scheduledJob.upsert({
    where: { jobId: SELF_OPTIMIZATION_SWEEP_TASK_ID },
    create: {
      jobId: SELF_OPTIMIZATION_SWEEP_TASK_ID,
      name: SELF_OPTIMIZATION_SWEEP_SCHEDULED_JOB_NAME,
      schedule: SELF_OPTIMIZATION_SWEEP_SCHEDULE,
      nextRunAt: existing?.nextRunAt ?? nextRunAt,
    },
    update: {
      name: SELF_OPTIMIZATION_SWEEP_SCHEDULED_JOB_NAME,
      schedule: SELF_OPTIMIZATION_SWEEP_SCHEDULE,
      nextRunAt: existing?.nextRunAt ?? nextRunAt,
    },
  });

  return { created: !existing };
}
