import type { PrismaClient } from "../generated/client/client";

/**
 * Schedule + identifier constants for the platform-managed data-retention sweep.
 *
 * Spec: docs/superpowers/specs/2026-06-14-data-retention-lifecycle-governance-design.md
 *
 * The ScheduledJob row is the live heartbeat surfaced in the Scheduled Jobs
 * admin view and carries the recent-run summaries in `metadata`.
 *
 * These identifiers are duplicated (intentionally — packages/db cannot import
 * from apps/web) in apps/web/lib/operate/retention/constants.ts. If you change
 * one, change both, or the heartbeat row will be orphaned.
 */
export const DATA_RETENTION_JOB_ID = "data-retention-sweep";
export const DATA_RETENTION_JOB_NAME =
  "Data retention sweep (platform-managed)";
export const DATA_RETENTION_SCHEDULE = "daily";

type ScheduledJobSeedClient = Pick<PrismaClient, "scheduledJob">;

/** Returns the next 04:00 UTC strictly after `from` (after the 03:00 backups). */
function nextRetentionRunAt(from: Date): Date {
  const next = new Date(from);
  next.setUTCSeconds(0, 0);
  next.setUTCMinutes(0);
  next.setUTCHours(4);
  if (next <= from) {
    next.setUTCDate(next.getUTCDate() + 1);
  }
  return next;
}

/**
 * Idempotent: create the data-retention ScheduledJob heartbeat row if missing;
 * update name/schedule/nextRunAt on every seed run. Does not clobber
 * lastRunAt / lastStatus / lastError / metadata / enabled — those are owned by
 * the runner and the operator (the `enabled` flag is the kill switch).
 */
export async function ensureDataRetentionScheduledJob(
  prisma: ScheduledJobSeedClient,
  now: Date = new Date(),
): Promise<{ created: boolean }> {
  const nextRunAt = nextRetentionRunAt(now);

  const existing = await prisma.scheduledJob.findUnique({
    where: { jobId: DATA_RETENTION_JOB_ID },
    select: { jobId: true, nextRunAt: true },
  });

  if (existing) {
    await prisma.scheduledJob.update({
      where: { jobId: DATA_RETENTION_JOB_ID },
      data: {
        name: DATA_RETENTION_JOB_NAME,
        schedule: DATA_RETENTION_SCHEDULE,
        nextRunAt: existing.nextRunAt ?? nextRunAt,
      },
    });
    return { created: false };
  }

  await prisma.scheduledJob.create({
    data: {
      jobId: DATA_RETENTION_JOB_ID,
      name: DATA_RETENTION_JOB_NAME,
      schedule: DATA_RETENTION_SCHEDULE,
      nextRunAt,
    },
  });
  return { created: true };
}
