// packages/db/src/seed-demand-scoring-steward.ts
// The standing daily demand-scoring steward (BI-00C68162). Seeds the task so
// every install proposes demand scores for unscored triaged work without anyone
// remembering to ask. The deterministic handler lives in apps/web's scheduler
// (executeScheduledAgentTask branches on taskKind and runs
// executeDemandScoringStewardTask — no LLM loop).
//
// Mirrors seed-decision-engine-review.ts deliberately: same shape, same
// idempotence. One difference: taskConfig (the batch size) is written on create
// only, so an operator's tuning survives re-seeding.

import type { PrismaClient } from "../generated/client/client";

import {
  DEMAND_SCORING_STEWARD_AGENT_ID,
  DEMAND_SCORING_STEWARD_DEFAULT_CONFIG,
  DEMAND_SCORING_STEWARD_DEFAULT_TIMEZONE,
  DEMAND_SCORING_STEWARD_PROMPT,
  DEMAND_SCORING_STEWARD_ROUTE_CONTEXT,
  DEMAND_SCORING_STEWARD_SCHEDULE,
  DEMAND_SCORING_STEWARD_SCHEDULED_JOB_NAME,
  DEMAND_SCORING_STEWARD_TASK_ID,
  DEMAND_SCORING_STEWARD_TASK_KIND,
  DEMAND_SCORING_STEWARD_TASK_TITLE,
} from "./demand-scoring-steward-config";

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

export async function ensureDemandScoringStewardScheduledTask(
  prisma: ScheduledTaskSeedClient,
  now: Date = new Date(),
): Promise<{ created: boolean }> {
  const owner = await prisma.user.findFirst({
    where: { isSuperuser: true },
    orderBy: { createdAt: "asc" },
    select: { id: true },
  });
  if (!owner) {
    throw new Error("seed: no superuser found - cannot seed demand-scoring steward scheduled task");
  }

  const timezone = process.env.INSTALL_TIMEZONE ?? DEMAND_SCORING_STEWARD_DEFAULT_TIMEZONE;
  const nextRunAt = computeNextCronRun(DEMAND_SCORING_STEWARD_SCHEDULE, now);

  const existing = await prisma.scheduledAgentTask.findUnique({
    where: { taskId: DEMAND_SCORING_STEWARD_TASK_ID },
    select: { taskId: true, nextRunAt: true },
  });

  // An existing task keeps its owner: an account handover must survive re-seeding (BI-ED055D45).
  if (existing) {
    await prisma.scheduledAgentTask.update({
      where: { taskId: DEMAND_SCORING_STEWARD_TASK_ID },
      data: {
        agentId: DEMAND_SCORING_STEWARD_AGENT_ID,
        title: DEMAND_SCORING_STEWARD_TASK_TITLE,
        prompt: DEMAND_SCORING_STEWARD_PROMPT,
        routeContext: DEMAND_SCORING_STEWARD_ROUTE_CONTEXT,
        schedule: DEMAND_SCORING_STEWARD_SCHEDULE,
        timezone,
        taskKind: DEMAND_SCORING_STEWARD_TASK_KIND,
        isActive: true,
        nextRunAt: existing.nextRunAt ?? nextRunAt,
      },
    });
  } else {
    await prisma.scheduledAgentTask.create({
      data: {
        taskId: DEMAND_SCORING_STEWARD_TASK_ID,
        agentId: DEMAND_SCORING_STEWARD_AGENT_ID,
        title: DEMAND_SCORING_STEWARD_TASK_TITLE,
        prompt: DEMAND_SCORING_STEWARD_PROMPT,
        routeContext: DEMAND_SCORING_STEWARD_ROUTE_CONTEXT,
        schedule: DEMAND_SCORING_STEWARD_SCHEDULE,
        timezone,
        taskKind: DEMAND_SCORING_STEWARD_TASK_KIND,
        taskConfig: { ...DEMAND_SCORING_STEWARD_DEFAULT_CONFIG },
        ownerUserId: owner.id,
        nextRunAt,
      },
    });
  }

  await prisma.scheduledJob.upsert({
    where: { jobId: DEMAND_SCORING_STEWARD_TASK_ID },
    create: {
      jobId: DEMAND_SCORING_STEWARD_TASK_ID,
      name: DEMAND_SCORING_STEWARD_SCHEDULED_JOB_NAME,
      schedule: DEMAND_SCORING_STEWARD_SCHEDULE,
      nextRunAt: existing?.nextRunAt ?? nextRunAt,
    },
    update: {
      name: DEMAND_SCORING_STEWARD_SCHEDULED_JOB_NAME,
      schedule: DEMAND_SCORING_STEWARD_SCHEDULE,
      nextRunAt: existing?.nextRunAt ?? nextRunAt,
    },
  });

  return { created: !existing };
}
