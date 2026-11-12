// packages/db/src/seed-harness-evolution-loop.ts
// The standing daily harness evolution loop (BI-49BC21C1). Seeds the task so
// every install ranks its recurring agent misses into harness-edit candidates
// without a client or anyone remembering to ask. The deterministic handler
// lives in apps/web's scheduler (runDeterministicScheduledTaskKind runs
// executeHarnessEvolutionLoopTask — no LLM loop).
//
// Mirrors seed-demand-scoring-steward.ts deliberately: same shape, same
// idempotence; taskConfig (the budget caps and seed queue) is written on
// create only, so an operator's tuning survives re-seeding.

import type { PrismaClient } from "../generated/client/client";

import {
  HARNESS_EVOLUTION_LOOP_AGENT_ID,
  HARNESS_EVOLUTION_LOOP_DEFAULT_CONFIG,
  HARNESS_EVOLUTION_LOOP_DEFAULT_TIMEZONE,
  HARNESS_EVOLUTION_LOOP_PROMPT,
  HARNESS_EVOLUTION_LOOP_ROUTE_CONTEXT,
  HARNESS_EVOLUTION_LOOP_SCHEDULE,
  HARNESS_EVOLUTION_LOOP_SCHEDULED_JOB_NAME,
  HARNESS_EVOLUTION_LOOP_TASK_ID,
  HARNESS_EVOLUTION_LOOP_TASK_KIND,
  HARNESS_EVOLUTION_LOOP_TASK_TITLE,
} from "./harness-evolution-loop-config";
import { findTaskOwnerUserId } from "./install-work-owner";

type ScheduledTaskSeedClient = Pick<PrismaClient, "user" | "portfolio" | "organization" | "principalAlias" | "scheduledAgentTask" | "scheduledJob">;

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

export async function ensureHarnessEvolutionLoopScheduledTask(
  prisma: ScheduledTaskSeedClient,
  now: Date = new Date(),
): Promise<{ created: boolean }> {
  const ownerId = await findTaskOwnerUserId(prisma);
  if (!ownerId) {
    throw new Error("seed: no superuser found - cannot seed harness evolution loop scheduled task");
  }

  const timezone = process.env.INSTALL_TIMEZONE ?? HARNESS_EVOLUTION_LOOP_DEFAULT_TIMEZONE;
  const nextRunAt = computeNextCronRun(HARNESS_EVOLUTION_LOOP_SCHEDULE, now);

  const existing = await prisma.scheduledAgentTask.findUnique({
    where: { taskId: HARNESS_EVOLUTION_LOOP_TASK_ID },
    select: { taskId: true, nextRunAt: true },
  });

  // An existing task keeps its owner: an account handover must survive re-seeding (BI-ED055D45).
  if (existing) {
    await prisma.scheduledAgentTask.update({
      where: { taskId: HARNESS_EVOLUTION_LOOP_TASK_ID },
      data: {
        agentId: HARNESS_EVOLUTION_LOOP_AGENT_ID,
        title: HARNESS_EVOLUTION_LOOP_TASK_TITLE,
        prompt: HARNESS_EVOLUTION_LOOP_PROMPT,
        routeContext: HARNESS_EVOLUTION_LOOP_ROUTE_CONTEXT,
        schedule: HARNESS_EVOLUTION_LOOP_SCHEDULE,
        timezone,
        taskKind: HARNESS_EVOLUTION_LOOP_TASK_KIND,
        isActive: true,
        nextRunAt: existing.nextRunAt ?? nextRunAt,
      },
    });
  } else {
    await prisma.scheduledAgentTask.create({
      data: {
        taskId: HARNESS_EVOLUTION_LOOP_TASK_ID,
        agentId: HARNESS_EVOLUTION_LOOP_AGENT_ID,
        title: HARNESS_EVOLUTION_LOOP_TASK_TITLE,
        prompt: HARNESS_EVOLUTION_LOOP_PROMPT,
        routeContext: HARNESS_EVOLUTION_LOOP_ROUTE_CONTEXT,
        schedule: HARNESS_EVOLUTION_LOOP_SCHEDULE,
        timezone,
        taskKind: HARNESS_EVOLUTION_LOOP_TASK_KIND,
        taskConfig: {
          ...HARNESS_EVOLUTION_LOOP_DEFAULT_CONFIG,
          seedItemIds: [...HARNESS_EVOLUTION_LOOP_DEFAULT_CONFIG.seedItemIds],
        },
        ownerUserId: ownerId,
        nextRunAt,
      },
    });
  }

  await prisma.scheduledJob.upsert({
    where: { jobId: HARNESS_EVOLUTION_LOOP_TASK_ID },
    create: {
      jobId: HARNESS_EVOLUTION_LOOP_TASK_ID,
      name: HARNESS_EVOLUTION_LOOP_SCHEDULED_JOB_NAME,
      schedule: HARNESS_EVOLUTION_LOOP_SCHEDULE,
      nextRunAt: existing?.nextRunAt ?? nextRunAt,
    },
    update: {
      name: HARNESS_EVOLUTION_LOOP_SCHEDULED_JOB_NAME,
      schedule: HARNESS_EVOLUTION_LOOP_SCHEDULE,
      nextRunAt: existing?.nextRunAt ?? nextRunAt,
    },
  });

  return { created: !existing };
}
