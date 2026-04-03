"use server";

import { prisma } from "@dpf/db";
import { pruneStaleInfraCIs } from "@dpf/db";
import { auth } from "@/lib/auth";
import { can } from "@/lib/permissions";
import { computeNextRunAt } from "@/lib/ai-provider-types";

const JOB_ID   = "infra-ci-prune";
const JOB_NAME = "Infrastructure CI Prune";

// Default thresholds (days)
const MARK_AFTER_DAYS   = 30;
const DELETE_AFTER_DAYS = 90;

async function requireManagePlatform(): Promise<void> {
  const session = await auth();
  const user = session?.user;
  if (!user || !can({ platformRole: user.platformRole, isSuperuser: user.isSuperuser }, "manage_provider_connections")) {
    throw new Error("Unauthorized");
  }
}

/** Ensure the ScheduledJob record exists. Call from page load. */
async function ensureInfraPruneJob(): Promise<{
  schedule: string;
  nextRunAt: Date | null;
}> {
  return prisma.scheduledJob.upsert({
    where:  { jobId: JOB_ID },
    create: {
      jobId:     JOB_ID,
      name:      JOB_NAME,
      schedule:  "weekly",
      nextRunAt: computeNextRunAt("weekly", new Date()),
    },
    update: {},
    select: { schedule: true, nextRunAt: true },
  });
}

/** Run the prune immediately, update the ScheduledJob record, and return counts. */
export async function runInfraPruneNow(): Promise<{ ok: boolean; marked: number; deleted: number; error?: string }> {
  await requireManagePlatform();

  const job = await ensureInfraPruneJob();

  await prisma.scheduledJob.update({
    where: { jobId: JOB_ID },
    data:  { lastRunAt: new Date(), lastStatus: "running" },
  });

  try {
    const result = await pruneStaleInfraCIs({
      markDecommissionedAfterDays: MARK_AFTER_DAYS,
      deleteAfterDays:             DELETE_AFTER_DAYS,
    });

    const now = new Date();
    await prisma.scheduledJob.update({
      where: { jobId: JOB_ID },
      data: {
        lastRunAt:  now,
        lastStatus: "ok",
        lastError:  null,
        nextRunAt:  computeNextRunAt(job.schedule, now),
      },
    });

    return { ok: true, ...result };
  } catch (err: unknown) {
    const error = err instanceof Error ? err.message : String(err);
    await prisma.scheduledJob.update({
      where: { jobId: JOB_ID },
      data:  { lastRunAt: new Date(), lastStatus: "error", lastError: error },
    }).catch(() => {});
    return { ok: false, marked: 0, deleted: 0, error };
  }
}

/**
 * Called from the platform sync page server component on each load.
 * Ensures the job record exists and runs the prune if it is due.
 */
export async function runInfraPruneIfDue(): Promise<void> {
  const job = await ensureInfraPruneJob();
  if (
    job.schedule !== "disabled" &&
    job.nextRunAt != null &&
    job.nextRunAt < new Date()
  ) {
    // Fire-and-forget — page load should not block on the prune
    void pruneStaleInfraCIs({
      markDecommissionedAfterDays: MARK_AFTER_DAYS,
      deleteAfterDays:             DELETE_AFTER_DAYS,
    }).then(async () => {
      const now = new Date();
      await prisma.scheduledJob.update({
        where: { jobId: JOB_ID },
        data:  { lastRunAt: now, lastStatus: "ok", lastError: null, nextRunAt: computeNextRunAt(job.schedule, now) },
      }).catch(() => {});
    }).catch(async (err: unknown) => {
      const error = err instanceof Error ? err.message : String(err);
      await prisma.scheduledJob.update({
        where: { jobId: JOB_ID },
        data:  { lastRunAt: new Date(), lastStatus: "error", lastError: error },
      }).catch(() => {});
    });
  }
}

/** Update the schedule for the infra prune job. */
export async function updateInfraPruneSchedule(schedule: string): Promise<void> {
  await requireManagePlatform();
  const nextRunAt = computeNextRunAt(schedule, new Date());
  await prisma.scheduledJob.upsert({
    where:  { jobId: JOB_ID },
    create: { jobId: JOB_ID, name: JOB_NAME, schedule, nextRunAt },
    update: { schedule, nextRunAt },
  });
}
