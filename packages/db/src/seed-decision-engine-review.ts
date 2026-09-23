// packages/db/src/seed-decision-engine-review.ts
// The standing weekly decision-engine self-review (BI-19CEC4B4). Seeds the task
// so every install measures its own decision engine without anyone remembering
// to ask. The deterministic handler lives in apps/web's scheduler
// (executeScheduledAgentTask branches on taskKind and runs
// executeDecisionEngineReviewTask — no LLM loop).
//
// Mirrors seed-bookkeeping-cycle.ts deliberately: same shape, same idempotence,
// so the two standing cadences stay readable side by side.

import type { PrismaClient } from "../generated/client/client";

import {
  DECISION_ENGINE_REVIEW_AGENT_ID,
  DECISION_ENGINE_REVIEW_DEFAULT_TIMEZONE,
  DECISION_ENGINE_REVIEW_PROMPT,
  DECISION_ENGINE_REVIEW_ROUTE_CONTEXT,
  DECISION_ENGINE_REVIEW_SCHEDULE,
  DECISION_ENGINE_REVIEW_SCHEDULED_JOB_NAME,
  DECISION_ENGINE_REVIEW_TASK_ID,
  DECISION_ENGINE_REVIEW_TASK_KIND,
  DECISION_ENGINE_REVIEW_TASK_TITLE,
} from "./decision-engine-review-config";

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

export async function ensureDecisionEngineReviewScheduledTask(
  prisma: ScheduledTaskSeedClient,
  now: Date = new Date(),
): Promise<{ created: boolean }> {
  const owner = await prisma.user.findFirst({
    where: { isSuperuser: true },
    orderBy: { createdAt: "asc" },
    select: { id: true },
  });
  if (!owner) {
    throw new Error("seed: no superuser found - cannot seed decision-engine review scheduled task");
  }

  const timezone = process.env.INSTALL_TIMEZONE ?? DECISION_ENGINE_REVIEW_DEFAULT_TIMEZONE;
  const nextRunAt = computeNextCronRun(DECISION_ENGINE_REVIEW_SCHEDULE, now);

  const existing = await prisma.scheduledAgentTask.findUnique({
    where: { taskId: DECISION_ENGINE_REVIEW_TASK_ID },
    select: { taskId: true, nextRunAt: true },
  });

  if (existing) {
    await prisma.scheduledAgentTask.update({
      where: { taskId: DECISION_ENGINE_REVIEW_TASK_ID },
      data: {
        agentId: DECISION_ENGINE_REVIEW_AGENT_ID,
        title: DECISION_ENGINE_REVIEW_TASK_TITLE,
        prompt: DECISION_ENGINE_REVIEW_PROMPT,
        routeContext: DECISION_ENGINE_REVIEW_ROUTE_CONTEXT,
        schedule: DECISION_ENGINE_REVIEW_SCHEDULE,
        timezone,
        taskKind: DECISION_ENGINE_REVIEW_TASK_KIND,
        ownerUserId: owner.id,
        isActive: true,
        nextRunAt: existing.nextRunAt ?? nextRunAt,
      },
    });
  } else {
    await prisma.scheduledAgentTask.create({
      data: {
        taskId: DECISION_ENGINE_REVIEW_TASK_ID,
        agentId: DECISION_ENGINE_REVIEW_AGENT_ID,
        title: DECISION_ENGINE_REVIEW_TASK_TITLE,
        prompt: DECISION_ENGINE_REVIEW_PROMPT,
        routeContext: DECISION_ENGINE_REVIEW_ROUTE_CONTEXT,
        schedule: DECISION_ENGINE_REVIEW_SCHEDULE,
        timezone,
        taskKind: DECISION_ENGINE_REVIEW_TASK_KIND,
        ownerUserId: owner.id,
        nextRunAt,
      },
    });
  }

  await prisma.scheduledJob.upsert({
    where: { jobId: DECISION_ENGINE_REVIEW_TASK_ID },
    create: {
      jobId: DECISION_ENGINE_REVIEW_TASK_ID,
      name: DECISION_ENGINE_REVIEW_SCHEDULED_JOB_NAME,
      schedule: DECISION_ENGINE_REVIEW_SCHEDULE,
      nextRunAt: existing?.nextRunAt ?? nextRunAt,
    },
    update: {
      name: DECISION_ENGINE_REVIEW_SCHEDULED_JOB_NAME,
      schedule: DECISION_ENGINE_REVIEW_SCHEDULE,
      nextRunAt: existing?.nextRunAt ?? nextRunAt,
    },
  });

  return { created: !existing };
}
