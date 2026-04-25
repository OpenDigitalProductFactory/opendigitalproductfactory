import type { PrismaClient } from "../generated/client/client";

import {
  buildDiscoveryTriageScheduledPrompt,
  DISCOVERY_TRIAGE_AGENT_ID,
  DISCOVERY_TRIAGE_DEFAULT_TIMEZONE,
  DISCOVERY_TRIAGE_ROUTE_CONTEXT,
  DISCOVERY_TRIAGE_SCHEDULE,
  DISCOVERY_TRIAGE_SCHEDULED_JOB_NAME,
  DISCOVERY_TRIAGE_TASK_ID,
  DISCOVERY_TRIAGE_TASK_TITLE,
} from "./discovery-triage-config";

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

export async function ensureDiscoveryTriageScheduledTask(
  prisma: ScheduledTaskSeedClient,
  now: Date = new Date(),
): Promise<{ created: boolean; ownerUserId: string }> {
  const owner = await prisma.user.findFirst({
    where: { isSuperuser: true },
    orderBy: { createdAt: "asc" },
    select: { id: true },
  });

  if (!owner) {
    throw new Error("seed: no superuser found - cannot seed discovery triage scheduled task");
  }

  const timezone = process.env.INSTALL_TIMEZONE ?? DISCOVERY_TRIAGE_DEFAULT_TIMEZONE;
  const prompt = buildDiscoveryTriageScheduledPrompt();
  const nextRunAt = computeNextCronRun(DISCOVERY_TRIAGE_SCHEDULE, now);

  const existingTask = await prisma.scheduledAgentTask.findUnique({
    where: { taskId: DISCOVERY_TRIAGE_TASK_ID },
    select: { taskId: true, nextRunAt: true },
  });

  if (existingTask) {
    await prisma.scheduledAgentTask.update({
      where: { taskId: DISCOVERY_TRIAGE_TASK_ID },
      data: {
        agentId: DISCOVERY_TRIAGE_AGENT_ID,
        title: DISCOVERY_TRIAGE_TASK_TITLE,
        prompt,
        routeContext: DISCOVERY_TRIAGE_ROUTE_CONTEXT,
        schedule: DISCOVERY_TRIAGE_SCHEDULE,
        timezone,
        ownerUserId: owner.id,
        isActive: true,
        nextRunAt: existingTask.nextRunAt ?? nextRunAt,
      },
    });
  } else {
    await prisma.scheduledAgentTask.create({
      data: {
        taskId: DISCOVERY_TRIAGE_TASK_ID,
        agentId: DISCOVERY_TRIAGE_AGENT_ID,
        title: DISCOVERY_TRIAGE_TASK_TITLE,
        prompt,
        routeContext: DISCOVERY_TRIAGE_ROUTE_CONTEXT,
        schedule: DISCOVERY_TRIAGE_SCHEDULE,
        timezone,
        ownerUserId: owner.id,
        nextRunAt,
      },
    });
  }

  await prisma.scheduledJob.upsert({
    where: { jobId: DISCOVERY_TRIAGE_TASK_ID },
    create: {
      jobId: DISCOVERY_TRIAGE_TASK_ID,
      name: DISCOVERY_TRIAGE_SCHEDULED_JOB_NAME,
      schedule: DISCOVERY_TRIAGE_SCHEDULE,
      nextRunAt: existingTask?.nextRunAt ?? nextRunAt,
    },
    update: {
      name: DISCOVERY_TRIAGE_SCHEDULED_JOB_NAME,
      schedule: DISCOVERY_TRIAGE_SCHEDULE,
      nextRunAt: existingTask?.nextRunAt ?? nextRunAt,
    },
  });

  return {
    created: !existingTask,
    ownerUserId: owner.id,
  };
}
