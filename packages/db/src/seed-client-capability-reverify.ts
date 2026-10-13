// packages/db/src/seed-client-capability-reverify.ts
// The standing weekly client-capability re-verification (BI-64795FD0). Seeds
// the task so every install notices client releases the capability profile has
// not verified. The deterministic handler lives in apps/web's scheduler
// (runDeterministicScheduledTaskKind runs executeClientCapabilityReverifyTask;
// no LLM loop).
//
// Mirrors seed-demand-scoring-steward.ts. taskConfig holds the run state
// (source snapshots, verificationStale, failed-run count), so the seed never
// writes it: a re-seed must not erase what the task has learned.

import type { PrismaClient } from "../generated/client/client";

import {
  CLIENT_CAPABILITY_REVERIFY_AGENT_ID,
  CLIENT_CAPABILITY_REVERIFY_DEFAULT_TIMEZONE,
  CLIENT_CAPABILITY_REVERIFY_PROMPT,
  CLIENT_CAPABILITY_REVERIFY_ROUTE_CONTEXT,
  CLIENT_CAPABILITY_REVERIFY_SCHEDULE,
  CLIENT_CAPABILITY_REVERIFY_SCHEDULED_JOB_NAME,
  CLIENT_CAPABILITY_REVERIFY_TASK_ID,
  CLIENT_CAPABILITY_REVERIFY_TASK_KIND,
  CLIENT_CAPABILITY_REVERIFY_TASK_TITLE,
} from "./client-capability-reverify-config";

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

export async function ensureClientCapabilityReverifyScheduledTask(
  prisma: ScheduledTaskSeedClient,
  now: Date = new Date(),
): Promise<{ created: boolean }> {
  const owner = await prisma.user.findFirst({
    where: { isSuperuser: true },
    orderBy: { createdAt: "asc" },
    select: { id: true },
  });
  if (!owner) {
    throw new Error("seed: no superuser found - cannot seed client-capability re-verification scheduled task");
  }

  const timezone = process.env.INSTALL_TIMEZONE ?? CLIENT_CAPABILITY_REVERIFY_DEFAULT_TIMEZONE;
  const nextRunAt = computeNextCronRun(CLIENT_CAPABILITY_REVERIFY_SCHEDULE, now);

  const existing = await prisma.scheduledAgentTask.findUnique({
    where: { taskId: CLIENT_CAPABILITY_REVERIFY_TASK_ID },
    select: { taskId: true, nextRunAt: true },
  });

  // An existing task keeps its owner: an account handover must survive re-seeding (BI-ED055D45).
  if (existing) {
    await prisma.scheduledAgentTask.update({
      where: { taskId: CLIENT_CAPABILITY_REVERIFY_TASK_ID },
      data: {
        agentId: CLIENT_CAPABILITY_REVERIFY_AGENT_ID,
        title: CLIENT_CAPABILITY_REVERIFY_TASK_TITLE,
        prompt: CLIENT_CAPABILITY_REVERIFY_PROMPT,
        routeContext: CLIENT_CAPABILITY_REVERIFY_ROUTE_CONTEXT,
        schedule: CLIENT_CAPABILITY_REVERIFY_SCHEDULE,
        timezone,
        taskKind: CLIENT_CAPABILITY_REVERIFY_TASK_KIND,
        isActive: true,
        nextRunAt: existing.nextRunAt ?? nextRunAt,
      },
    });
  } else {
    await prisma.scheduledAgentTask.create({
      data: {
        taskId: CLIENT_CAPABILITY_REVERIFY_TASK_ID,
        agentId: CLIENT_CAPABILITY_REVERIFY_AGENT_ID,
        title: CLIENT_CAPABILITY_REVERIFY_TASK_TITLE,
        prompt: CLIENT_CAPABILITY_REVERIFY_PROMPT,
        routeContext: CLIENT_CAPABILITY_REVERIFY_ROUTE_CONTEXT,
        schedule: CLIENT_CAPABILITY_REVERIFY_SCHEDULE,
        timezone,
        taskKind: CLIENT_CAPABILITY_REVERIFY_TASK_KIND,
        ownerUserId: owner.id,
        nextRunAt,
      },
    });
  }

  await prisma.scheduledJob.upsert({
    where: { jobId: CLIENT_CAPABILITY_REVERIFY_TASK_ID },
    create: {
      jobId: CLIENT_CAPABILITY_REVERIFY_TASK_ID,
      name: CLIENT_CAPABILITY_REVERIFY_SCHEDULED_JOB_NAME,
      schedule: CLIENT_CAPABILITY_REVERIFY_SCHEDULE,
      nextRunAt: existing?.nextRunAt ?? nextRunAt,
    },
    update: {
      name: CLIENT_CAPABILITY_REVERIFY_SCHEDULED_JOB_NAME,
      schedule: CLIENT_CAPABILITY_REVERIFY_SCHEDULE,
      nextRunAt: existing?.nextRunAt ?? nextRunAt,
    },
  });

  return { created: !existing };
}
