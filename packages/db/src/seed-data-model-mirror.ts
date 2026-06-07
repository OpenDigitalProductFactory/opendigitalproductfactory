// packages/db/src/seed-data-model-mirror.ts
// EP-DATA-ARCH Phase 6 (BI-8E274CD3): seed the nightly data-model mirror
// scheduled task. The deterministic handler lives in apps/web's scheduler
// (executeScheduledAgentTask early-branches on this task id and runs
// runDataModelMirror without an LLM loop).
import type { PrismaClient } from "../generated/client/client";

import {
  DATA_MODEL_MIRROR_AGENT_ID,
  DATA_MODEL_MIRROR_DEFAULT_TIMEZONE,
  DATA_MODEL_MIRROR_PROMPT,
  DATA_MODEL_MIRROR_ROUTE_CONTEXT,
  DATA_MODEL_MIRROR_SCHEDULE,
  DATA_MODEL_MIRROR_SCHEDULED_JOB_NAME,
  DATA_MODEL_MIRROR_TASK_ID,
  DATA_MODEL_MIRROR_TASK_TITLE,
} from "./data-model-mirror-config";

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

export async function ensureDataModelMirrorScheduledTask(
  prisma: ScheduledTaskSeedClient,
  now: Date = new Date(),
): Promise<{ created: boolean }> {
  const owner = await prisma.user.findFirst({
    where: { isSuperuser: true },
    orderBy: { createdAt: "asc" },
    select: { id: true },
  });
  if (!owner) {
    throw new Error("seed: no superuser found - cannot seed data-model mirror scheduled task");
  }

  const timezone = process.env.INSTALL_TIMEZONE ?? DATA_MODEL_MIRROR_DEFAULT_TIMEZONE;
  const nextRunAt = computeNextCronRun(DATA_MODEL_MIRROR_SCHEDULE, now);

  const existing = await prisma.scheduledAgentTask.findUnique({
    where: { taskId: DATA_MODEL_MIRROR_TASK_ID },
    select: { taskId: true, nextRunAt: true },
  });

  if (existing) {
    await prisma.scheduledAgentTask.update({
      where: { taskId: DATA_MODEL_MIRROR_TASK_ID },
      data: {
        agentId: DATA_MODEL_MIRROR_AGENT_ID,
        title: DATA_MODEL_MIRROR_TASK_TITLE,
        prompt: DATA_MODEL_MIRROR_PROMPT,
        routeContext: DATA_MODEL_MIRROR_ROUTE_CONTEXT,
        schedule: DATA_MODEL_MIRROR_SCHEDULE,
        timezone,
        ownerUserId: owner.id,
        isActive: true,
        nextRunAt: existing.nextRunAt ?? nextRunAt,
      },
    });
  } else {
    await prisma.scheduledAgentTask.create({
      data: {
        taskId: DATA_MODEL_MIRROR_TASK_ID,
        agentId: DATA_MODEL_MIRROR_AGENT_ID,
        title: DATA_MODEL_MIRROR_TASK_TITLE,
        prompt: DATA_MODEL_MIRROR_PROMPT,
        routeContext: DATA_MODEL_MIRROR_ROUTE_CONTEXT,
        schedule: DATA_MODEL_MIRROR_SCHEDULE,
        timezone,
        ownerUserId: owner.id,
        nextRunAt,
      },
    });
  }

  await prisma.scheduledJob.upsert({
    where: { jobId: DATA_MODEL_MIRROR_TASK_ID },
    create: {
      jobId: DATA_MODEL_MIRROR_TASK_ID,
      name: DATA_MODEL_MIRROR_SCHEDULED_JOB_NAME,
      schedule: DATA_MODEL_MIRROR_SCHEDULE,
      nextRunAt: existing?.nextRunAt ?? nextRunAt,
    },
    update: {
      name: DATA_MODEL_MIRROR_SCHEDULED_JOB_NAME,
      schedule: DATA_MODEL_MIRROR_SCHEDULE,
      nextRunAt: existing?.nextRunAt ?? nextRunAt,
    },
  });

  return { created: !existing };
}
