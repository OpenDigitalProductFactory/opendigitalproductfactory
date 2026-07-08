import type { PrismaClient } from "../generated/client/client";

/**
 * Schedule + identifier constants for the platform-managed Inngest-retention
 * sweep (BI-0AB96FE7).
 *
 * The ScheduledJob row is the live heartbeat surfaced in the Scheduled Jobs
 * admin view (carries recent-run summaries in `metadata`) AND the operator kill
 * switch (`enabled=false` disables the sweep without a code change).
 *
 * These identifiers are duplicated (intentionally — packages/db cannot import
 * from apps/web) in apps/web/lib/operate/inngest-retention/constants.ts. If you
 * change one, change both, or the heartbeat row will be orphaned.
 */
export const INNGEST_RETENTION_JOB_ID = "inngest-retention-sweep";
export const INNGEST_RETENTION_JOB_NAME =
  "Inngest retention sweep (platform-managed)";
export const INNGEST_RETENTION_SCHEDULE = "every-6-hours";

type ScheduledJobSeedClient = Pick<PrismaClient, "scheduledJob">;

const SIX_HOURS_MS = 6 * 3_600_000;

/** Next :17 past the next 6-hour UTC boundary (00/06/12/18) after `from`. */
function nextInngestRetentionRunAt(from: Date): Date {
  const blockStart = Math.floor(from.getTime() / SIX_HOURS_MS) * SIX_HOURS_MS;
  let slot = blockStart + 17 * 60_000;
  if (slot <= from.getTime()) slot += SIX_HOURS_MS;
  return new Date(slot);
}

/**
 * Idempotent: create the Inngest-retention ScheduledJob heartbeat row if
 * missing; refresh name/schedule/nextRunAt on every seed run. Does not clobber
 * lastRunAt / lastStatus / lastError / metadata / enabled — those are owned by
 * the runner and the operator (the `enabled` flag is the kill switch).
 */
export async function ensureInngestRetentionScheduledJob(
  prisma: ScheduledJobSeedClient,
  now: Date = new Date(),
): Promise<{ created: boolean }> {
  const nextRunAt = nextInngestRetentionRunAt(now);

  const existing = await prisma.scheduledJob.findUnique({
    where: { jobId: INNGEST_RETENTION_JOB_ID },
    select: { jobId: true, nextRunAt: true },
  });

  if (existing) {
    await prisma.scheduledJob.update({
      where: { jobId: INNGEST_RETENTION_JOB_ID },
      data: {
        name: INNGEST_RETENTION_JOB_NAME,
        schedule: INNGEST_RETENTION_SCHEDULE,
        nextRunAt: existing.nextRunAt ?? nextRunAt,
      },
    });
    return { created: false };
  }

  await prisma.scheduledJob.create({
    data: {
      jobId: INNGEST_RETENTION_JOB_ID,
      name: INNGEST_RETENTION_JOB_NAME,
      schedule: INNGEST_RETENTION_SCHEDULE,
      nextRunAt,
    },
  });
  return { created: true };
}
