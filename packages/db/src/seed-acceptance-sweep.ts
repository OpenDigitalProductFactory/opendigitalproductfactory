// packages/db/src/seed-acceptance-sweep.ts
// The standing daily acceptance sweep (BI-DF255666). Seeds the task so every
// install revisits its awaiting-acceptance pool without anyone remembering to
// ask. The deterministic handler lives in apps/web's scheduler
// (executeScheduledAgentTask branches on taskKind and runs
// executeAcceptanceSweepTask; no LLM loop).
//
// Mirrors seed-decision-engine-review.ts deliberately: same shape, same
// idempotence, so the standing cadences stay readable side by side.

import type { PrismaClient } from "../generated/client/client";

import {
  ACCEPTANCE_SWEEP_AGENT_ID,
  ACCEPTANCE_SWEEP_DEFAULT_TIMEZONE,
  ACCEPTANCE_SWEEP_PROMPT,
  ACCEPTANCE_SWEEP_ROUTE_CONTEXT,
  ACCEPTANCE_SWEEP_SCHEDULE,
  ACCEPTANCE_SWEEP_SCHEDULED_JOB_NAME,
  ACCEPTANCE_SWEEP_TASK_ID,
  ACCEPTANCE_SWEEP_TASK_KIND,
  ACCEPTANCE_SWEEP_TASK_TITLE,
} from "./acceptance-sweep-config";

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

export async function ensureAcceptanceSweepScheduledTask(
  prisma: ScheduledTaskSeedClient,
  now: Date = new Date(),
): Promise<{ created: boolean }> {
  const owner = await prisma.user.findFirst({
    where: { isSuperuser: true },
    orderBy: { createdAt: "asc" },
    select: { id: true },
  });
  if (!owner) {
    throw new Error("seed: no superuser found - cannot seed acceptance-sweep scheduled task");
  }

  const timezone = process.env.INSTALL_TIMEZONE ?? ACCEPTANCE_SWEEP_DEFAULT_TIMEZONE;
  const nextRunAt = computeNextCronRun(ACCEPTANCE_SWEEP_SCHEDULE, now);

  const existing = await prisma.scheduledAgentTask.findUnique({
    where: { taskId: ACCEPTANCE_SWEEP_TASK_ID },
    select: { taskId: true, nextRunAt: true },
  });

  // An existing task keeps its owner: an account handover must survive re-seeding (BI-ED055D45).
  if (existing) {
    await prisma.scheduledAgentTask.update({
      where: { taskId: ACCEPTANCE_SWEEP_TASK_ID },
      data: {
        agentId: ACCEPTANCE_SWEEP_AGENT_ID,
        title: ACCEPTANCE_SWEEP_TASK_TITLE,
        prompt: ACCEPTANCE_SWEEP_PROMPT,
        routeContext: ACCEPTANCE_SWEEP_ROUTE_CONTEXT,
        schedule: ACCEPTANCE_SWEEP_SCHEDULE,
        timezone,
        taskKind: ACCEPTANCE_SWEEP_TASK_KIND,
        isActive: true,
        nextRunAt: existing.nextRunAt ?? nextRunAt,
      },
    });
  } else {
    await prisma.scheduledAgentTask.create({
      data: {
        taskId: ACCEPTANCE_SWEEP_TASK_ID,
        agentId: ACCEPTANCE_SWEEP_AGENT_ID,
        title: ACCEPTANCE_SWEEP_TASK_TITLE,
        prompt: ACCEPTANCE_SWEEP_PROMPT,
        routeContext: ACCEPTANCE_SWEEP_ROUTE_CONTEXT,
        schedule: ACCEPTANCE_SWEEP_SCHEDULE,
        timezone,
        taskKind: ACCEPTANCE_SWEEP_TASK_KIND,
        ownerUserId: owner.id,
        nextRunAt,
      },
    });
  }

  await prisma.scheduledJob.upsert({
    where: { jobId: ACCEPTANCE_SWEEP_TASK_ID },
    create: {
      jobId: ACCEPTANCE_SWEEP_TASK_ID,
      name: ACCEPTANCE_SWEEP_SCHEDULED_JOB_NAME,
      schedule: ACCEPTANCE_SWEEP_SCHEDULE,
      nextRunAt: existing?.nextRunAt ?? nextRunAt,
    },
    update: {
      name: ACCEPTANCE_SWEEP_SCHEDULED_JOB_NAME,
      schedule: ACCEPTANCE_SWEEP_SCHEDULE,
      nextRunAt: existing?.nextRunAt ?? nextRunAt,
    },
  });

  return { created: !existing };
}
