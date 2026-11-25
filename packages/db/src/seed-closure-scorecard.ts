// packages/db/src/seed-closure-scorecard.ts
// The standing daily closure scorecard (BI-97C56E20). Seeds the task so every
// install measures whether its own work is finishing, without a client or
// anyone remembering to ask. The deterministic handler lives in apps/web's
// scheduler (runDeterministicScheduledTaskKind runs executeClosureScorecardTask
// — no LLM loop).
//
// Mirrors seed-harness-evolution-loop.ts deliberately: same shape, same
// idempotence, and an existing task keeps its owner across re-seeding.

import type { PrismaClient } from "../generated/client/client";

import {
  CLOSURE_SCORECARD_AGENT_ID,
  CLOSURE_SCORECARD_DEFAULT_TIMEZONE,
  CLOSURE_SCORECARD_PROMPT,
  CLOSURE_SCORECARD_ROUTE_CONTEXT,
  CLOSURE_SCORECARD_SCHEDULE,
  CLOSURE_SCORECARD_SCHEDULED_JOB_NAME,
  CLOSURE_SCORECARD_TASK_ID,
  CLOSURE_SCORECARD_TASK_KIND,
  CLOSURE_SCORECARD_TASK_TITLE,
} from "./closure-scorecard-config";
import { findTaskOwnerUserId } from "./install-work-owner";

type ScheduledTaskSeedClient = Pick<PrismaClient, "user" | "portfolio" | "organization" | "principalAlias" | "scheduledAgentTask" | "scheduledJob">;

/** Next daily occurrence of a "M H * * *" expression, in UTC. */
export function nextDailyRun(cronExpr: string, from: Date): Date {
  const parts = cronExpr.trim().split(/\s+/);
  const next = new Date(from);
  if (parts.length !== 5) {
    next.setUTCDate(next.getUTCDate() + 1);
    return next;
  }
  const [minPart, hourPart] = parts;
  const minute = minPart === "*" ? 0 : parseInt(minPart!, 10);
  const hour = hourPart === "*" ? from.getUTCHours() : parseInt(hourPart!, 10);
  next.setUTCSeconds(0, 0);
  next.setUTCMinutes(minute);
  next.setUTCHours(hour);
  if (next <= from) next.setUTCDate(next.getUTCDate() + 1);
  return next;
}

export async function ensureClosureScorecardScheduledTask(
  prisma: ScheduledTaskSeedClient,
  now: Date = new Date(),
): Promise<{ created: boolean }> {
  const ownerId = await findTaskOwnerUserId(prisma);
  if (!ownerId) {
    throw new Error("seed: no superuser found - cannot seed closure scorecard scheduled task");
  }

  const timezone = process.env.INSTALL_TIMEZONE ?? CLOSURE_SCORECARD_DEFAULT_TIMEZONE;
  const nextRunAt = nextDailyRun(CLOSURE_SCORECARD_SCHEDULE, now);

  const existing = await prisma.scheduledAgentTask.findUnique({
    where: { taskId: CLOSURE_SCORECARD_TASK_ID },
    select: { taskId: true, nextRunAt: true },
  });

  const fields = {
    agentId: CLOSURE_SCORECARD_AGENT_ID,
    title: CLOSURE_SCORECARD_TASK_TITLE,
    prompt: CLOSURE_SCORECARD_PROMPT,
    routeContext: CLOSURE_SCORECARD_ROUTE_CONTEXT,
    schedule: CLOSURE_SCORECARD_SCHEDULE,
    timezone,
    taskKind: CLOSURE_SCORECARD_TASK_KIND,
    isActive: true,
  };

  // An existing task keeps its owner: an account handover must survive re-seeding (BI-ED055D45).
  if (existing) {
    await prisma.scheduledAgentTask.update({
      where: { taskId: CLOSURE_SCORECARD_TASK_ID },
      data: { ...fields, nextRunAt: existing.nextRunAt ?? nextRunAt },
    });
  } else {
    await prisma.scheduledAgentTask.create({
      data: { taskId: CLOSURE_SCORECARD_TASK_ID, ...fields, ownerUserId: ownerId, nextRunAt },
    });
  }

  await prisma.scheduledJob.upsert({
    where: { jobId: CLOSURE_SCORECARD_TASK_ID },
    create: {
      jobId: CLOSURE_SCORECARD_TASK_ID,
      name: CLOSURE_SCORECARD_SCHEDULED_JOB_NAME,
      schedule: CLOSURE_SCORECARD_SCHEDULE,
      nextRunAt: existing?.nextRunAt ?? nextRunAt,
    },
    update: {
      name: CLOSURE_SCORECARD_SCHEDULED_JOB_NAME,
      schedule: CLOSURE_SCORECARD_SCHEDULE,
      nextRunAt: existing?.nextRunAt ?? nextRunAt,
    },
  });

  return { created: !existing };
}
