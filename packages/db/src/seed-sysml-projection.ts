// packages/db/src/seed-sysml-projection.ts
// Parity Engine: seed the nightly SysML-projection reconcile scheduled task. The
// deterministic handler lives in apps/web's scheduler (executeScheduledAgentTask
// early-branches on this task id and runs reconcileSysmlProjections without an LLM
// loop). Mirrors seed-data-model-mirror.ts.
import type { PrismaClient } from "../generated/client/client";

import {
  SYSML_PROJECTION_AGENT_ID,
  SYSML_PROJECTION_DEFAULT_TIMEZONE,
  SYSML_PROJECTION_PROMPT,
  SYSML_PROJECTION_ROUTE_CONTEXT,
  SYSML_PROJECTION_SCHEDULE,
  SYSML_PROJECTION_SCHEDULED_JOB_NAME,
  SYSML_PROJECTION_TASK_ID,
  SYSML_PROJECTION_TASK_TITLE,
} from "./sysml-projection-config";

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

export async function ensureSysmlProjectionScheduledTask(
  prisma: ScheduledTaskSeedClient,
  now: Date = new Date(),
): Promise<{ created: boolean }> {
  const owner = await prisma.user.findFirst({
    where: { isSuperuser: true },
    orderBy: { createdAt: "asc" },
    select: { id: true },
  });
  if (!owner) {
    throw new Error("seed: no superuser found - cannot seed SysML projection scheduled task");
  }

  const timezone = process.env.INSTALL_TIMEZONE ?? SYSML_PROJECTION_DEFAULT_TIMEZONE;
  const nextRunAt = computeNextCronRun(SYSML_PROJECTION_SCHEDULE, now);

  const existing = await prisma.scheduledAgentTask.findUnique({
    where: { taskId: SYSML_PROJECTION_TASK_ID },
    select: { taskId: true, nextRunAt: true },
  });

  if (existing) {
    await prisma.scheduledAgentTask.update({
      where: { taskId: SYSML_PROJECTION_TASK_ID },
      data: {
        agentId: SYSML_PROJECTION_AGENT_ID,
        title: SYSML_PROJECTION_TASK_TITLE,
        prompt: SYSML_PROJECTION_PROMPT,
        routeContext: SYSML_PROJECTION_ROUTE_CONTEXT,
        schedule: SYSML_PROJECTION_SCHEDULE,
        timezone,
        ownerUserId: owner.id,
        isActive: true,
        nextRunAt: existing.nextRunAt ?? nextRunAt,
      },
    });
  } else {
    await prisma.scheduledAgentTask.create({
      data: {
        taskId: SYSML_PROJECTION_TASK_ID,
        agentId: SYSML_PROJECTION_AGENT_ID,
        title: SYSML_PROJECTION_TASK_TITLE,
        prompt: SYSML_PROJECTION_PROMPT,
        routeContext: SYSML_PROJECTION_ROUTE_CONTEXT,
        schedule: SYSML_PROJECTION_SCHEDULE,
        timezone,
        ownerUserId: owner.id,
        nextRunAt,
      },
    });
  }

  await prisma.scheduledJob.upsert({
    where: { jobId: SYSML_PROJECTION_TASK_ID },
    create: {
      jobId: SYSML_PROJECTION_TASK_ID,
      name: SYSML_PROJECTION_SCHEDULED_JOB_NAME,
      schedule: SYSML_PROJECTION_SCHEDULE,
      nextRunAt: existing?.nextRunAt ?? nextRunAt,
    },
    update: {
      name: SYSML_PROJECTION_SCHEDULED_JOB_NAME,
      schedule: SYSML_PROJECTION_SCHEDULE,
      nextRunAt: existing?.nextRunAt ?? nextRunAt,
    },
  });

  return { created: !existing };
}
