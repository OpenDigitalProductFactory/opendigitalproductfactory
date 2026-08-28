// packages/db/src/seed-bookkeeping-cycle.ts
// The initial use of the Bookkeeping Work Room (BI-DC738330). Seeds the standing
// weekly `bookkeeping-cycle` scheduled task so the framework runs on every
// install. The deterministic handler lives in apps/web's scheduler
// (executeScheduledAgentTask branches on taskKind and runs
// executeBookkeepingCycleTask — no LLM loop).
import type { PrismaClient } from "../generated/client/client";

import {
  BOOKKEEPING_CYCLE_AGENT_ID,
  BOOKKEEPING_CYCLE_DEFAULT_TIMEZONE,
  BOOKKEEPING_CYCLE_PROMPT,
  BOOKKEEPING_CYCLE_ROUTE_CONTEXT,
  BOOKKEEPING_CYCLE_SCHEDULE,
  BOOKKEEPING_CYCLE_SCHEDULED_JOB_NAME,
  BOOKKEEPING_CYCLE_TASK_ID,
  BOOKKEEPING_CYCLE_TASK_KIND,
  BOOKKEEPING_CYCLE_TASK_TITLE,
} from "./bookkeeping-cycle-config";

type ScheduledTaskSeedClient = Pick<PrismaClient, "user" | "scheduledAgentTask" | "scheduledJob">;

function computeNextCronRun(cronExpr: string, from: Date): Date {
  const parts = cronExpr.trim().split(/\s+/);
  if (parts.length !== 5) {
    const fallback = new Date(from);
    fallback.setUTCDate(fallback.getUTCDate() + 1);
    return fallback;
  }
  const [minPart, hourPart] = parts;
  const minute = minPart === "*" ? 0 : parseInt(minPart!, 10);
  const hour = hourPart === "*" ? from.getUTCHours() : parseInt(hourPart!, 10);
  const next = new Date(from);
  next.setUTCSeconds(0, 0);
  next.setUTCMinutes(minute);
  next.setUTCHours(hour);
  if (next <= from) next.setUTCDate(next.getUTCDate() + 1);
  return next;
}

export async function ensureBookkeepingCycleScheduledTask(
  prisma: ScheduledTaskSeedClient,
  now: Date = new Date(),
): Promise<{ created: boolean }> {
  const owner = await prisma.user.findFirst({
    where: { isSuperuser: true },
    orderBy: { createdAt: "asc" },
    select: { id: true },
  });
  if (!owner) {
    throw new Error("seed: no superuser found - cannot seed bookkeeping cycle scheduled task");
  }

  const timezone = process.env.INSTALL_TIMEZONE ?? BOOKKEEPING_CYCLE_DEFAULT_TIMEZONE;
  const nextRunAt = computeNextCronRun(BOOKKEEPING_CYCLE_SCHEDULE, now);

  const existing = await prisma.scheduledAgentTask.findUnique({
    where: { taskId: BOOKKEEPING_CYCLE_TASK_ID },
    select: { taskId: true, nextRunAt: true },
  });

  if (existing) {
    await prisma.scheduledAgentTask.update({
      where: { taskId: BOOKKEEPING_CYCLE_TASK_ID },
      data: {
        agentId: BOOKKEEPING_CYCLE_AGENT_ID,
        title: BOOKKEEPING_CYCLE_TASK_TITLE,
        prompt: BOOKKEEPING_CYCLE_PROMPT,
        routeContext: BOOKKEEPING_CYCLE_ROUTE_CONTEXT,
        schedule: BOOKKEEPING_CYCLE_SCHEDULE,
        timezone,
        taskKind: BOOKKEEPING_CYCLE_TASK_KIND,
        ownerUserId: owner.id,
        isActive: true,
        nextRunAt: existing.nextRunAt ?? nextRunAt,
      },
    });
  } else {
    await prisma.scheduledAgentTask.create({
      data: {
        taskId: BOOKKEEPING_CYCLE_TASK_ID,
        agentId: BOOKKEEPING_CYCLE_AGENT_ID,
        title: BOOKKEEPING_CYCLE_TASK_TITLE,
        prompt: BOOKKEEPING_CYCLE_PROMPT,
        routeContext: BOOKKEEPING_CYCLE_ROUTE_CONTEXT,
        schedule: BOOKKEEPING_CYCLE_SCHEDULE,
        timezone,
        taskKind: BOOKKEEPING_CYCLE_TASK_KIND,
        ownerUserId: owner.id,
        nextRunAt,
      },
    });
  }

  await prisma.scheduledJob.upsert({
    where: { jobId: BOOKKEEPING_CYCLE_TASK_ID },
    create: {
      jobId: BOOKKEEPING_CYCLE_TASK_ID,
      name: BOOKKEEPING_CYCLE_SCHEDULED_JOB_NAME,
      schedule: BOOKKEEPING_CYCLE_SCHEDULE,
      nextRunAt: existing?.nextRunAt ?? nextRunAt,
    },
    update: {
      name: BOOKKEEPING_CYCLE_SCHEDULED_JOB_NAME,
      schedule: BOOKKEEPING_CYCLE_SCHEDULE,
      nextRunAt: existing?.nextRunAt ?? nextRunAt,
    },
  });

  return { created: !existing };
}
