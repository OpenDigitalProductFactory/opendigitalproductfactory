import type { PrismaClient } from "../generated/client/client";

import {
  buildHiveScoutScheduledPrompt,
  HIVE_SCOUT_AGENT_ID,
  HIVE_SCOUT_DEFAULT_TIMEZONE,
  HIVE_SCOUT_ROUTE_CONTEXT,
  HIVE_SCOUT_SCHEDULE,
  HIVE_SCOUT_SCHEDULED_JOB_NAME,
  HIVE_SCOUT_TASK_ID,
  HIVE_SCOUT_TASK_TITLE,
} from "./hive-scout-config";

type ScheduledTaskSeedClient = Pick<PrismaClient, "user" | "scheduledAgentTask" | "scheduledJob">;

function computeNextCronRun(cronExpr: string, from: Date): Date {
  const parts = cronExpr.trim().split(/\s+/);
  if (parts.length !== 5) {
    const fallback = new Date(from);
    fallback.setUTCDate(fallback.getUTCDate() + 1);
    return fallback;
  }

  const [minPart, hourPart, , , dowPart] = parts;
  const minute = minPart === "*" ? 0 : parseInt(minPart!, 10);
  const hour = hourPart === "*" ? from.getUTCHours() : parseInt(hourPart!, 10);

  const next = new Date(from);
  next.setUTCSeconds(0, 0);
  next.setUTCMinutes(minute);
  next.setUTCHours(hour);

  if (next <= from) {
    next.setUTCDate(next.getUTCDate() + 1);
  }

  if (dowPart && dowPart !== "*") {
    const targetDays = dowPart.split(",").map((value) => parseInt(value, 10));
    let safety = 0;
    while (!targetDays.includes(next.getUTCDay()) && safety < 8) {
      next.setUTCDate(next.getUTCDate() + 1);
      safety += 1;
    }
  }

  return next;
}

export async function ensureHiveScoutScheduledTask(
  prisma: ScheduledTaskSeedClient,
  now: Date = new Date(),
): Promise<{ created: boolean; ownerUserId: string }> {
  const owner = await prisma.user.findFirst({
    where: { isSuperuser: true },
    orderBy: { createdAt: "asc" },
    select: { id: true },
  });

  if (!owner) {
    throw new Error("seed: no superuser found - cannot seed Hive Scout scheduled task");
  }

  const timezone = process.env.INSTALL_TIMEZONE ?? HIVE_SCOUT_DEFAULT_TIMEZONE;
  const prompt = buildHiveScoutScheduledPrompt();
  const nextRunAt = computeNextCronRun(HIVE_SCOUT_SCHEDULE, now);

  const existingTask = await prisma.scheduledAgentTask.findUnique({
    where: { taskId: HIVE_SCOUT_TASK_ID },
    select: { taskId: true, nextRunAt: true },
  });

  if (existingTask) {
    await prisma.scheduledAgentTask.update({
      where: { taskId: HIVE_SCOUT_TASK_ID },
      data: {
        agentId: HIVE_SCOUT_AGENT_ID,
        title: HIVE_SCOUT_TASK_TITLE,
        prompt,
        routeContext: HIVE_SCOUT_ROUTE_CONTEXT,
        schedule: HIVE_SCOUT_SCHEDULE,
        timezone,
        ownerUserId: owner.id,
        isActive: true,
        nextRunAt: existingTask.nextRunAt ?? nextRunAt,
      },
    });
  } else {
    await prisma.scheduledAgentTask.create({
      data: {
        taskId: HIVE_SCOUT_TASK_ID,
        agentId: HIVE_SCOUT_AGENT_ID,
        title: HIVE_SCOUT_TASK_TITLE,
        prompt,
        routeContext: HIVE_SCOUT_ROUTE_CONTEXT,
        schedule: HIVE_SCOUT_SCHEDULE,
        timezone,
        ownerUserId: owner.id,
        nextRunAt,
      },
    });
  }

  await prisma.scheduledJob.upsert({
    where: { jobId: HIVE_SCOUT_TASK_ID },
    create: {
      jobId: HIVE_SCOUT_TASK_ID,
      name: HIVE_SCOUT_SCHEDULED_JOB_NAME,
      schedule: HIVE_SCOUT_SCHEDULE,
      nextRunAt: existingTask?.nextRunAt ?? nextRunAt,
    },
    update: {
      name: HIVE_SCOUT_SCHEDULED_JOB_NAME,
      schedule: HIVE_SCOUT_SCHEDULE,
      nextRunAt: existingTask?.nextRunAt ?? nextRunAt,
    },
  });

  return {
    created: !existingTask,
    ownerUserId: owner.id,
  };
}
