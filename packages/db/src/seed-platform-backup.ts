import type { PrismaClient } from "../generated/client/client";

/**
 * Schedule + identifier constants for the platform-managed Postgres backup.
 *
 * Spec: docs/superpowers/specs/2026-05-17-postgres-daily-backup-design.md
 * Plan: docs/superpowers/plans/2026-05-17-postgres-daily-backup-slice-1.md
 *
 * The ScheduledJob row is the live heartbeat surfaced in /admin/backups
 * (lastRunAt, nextRunAt, lastStatus). The actual cron firing is owned by
 * the Inngest function ops/postgres-daily-backup; this seed only ensures
 * the heartbeat row exists from a fresh install onward so the readiness
 * card has something to render before the first run.
 *
 * The same identifiers are duplicated (intentionally — packages/db cannot
 * import from apps/web) in apps/web/lib/operate/backups/constants.ts.
 * If you change one, change both, or the heartbeat row will be orphaned.
 */
export const POSTGRES_BACKUP_JOB_ID = "postgres-daily-backup";
export const POSTGRES_BACKUP_JOB_NAME =
  "Postgres daily backup (platform-managed)";
export const POSTGRES_BACKUP_SCHEDULE = "daily";

type ScheduledJobSeedClient = Pick<PrismaClient, "scheduledJob">;

/** Returns the next 03:00 UTC strictly after `from`. */
function nextDailyRunAt(from: Date): Date {
  const next = new Date(from);
  next.setUTCSeconds(0, 0);
  next.setUTCMinutes(0);
  next.setUTCHours(3);
  if (next <= from) {
    next.setUTCDate(next.getUTCDate() + 1);
  }
  return next;
}

/**
 * Idempotent: create the ScheduledJob heartbeat row if missing; update
 * name/schedule/nextRunAt on every seed run. Does not clobber lastRunAt /
 * lastStatus / lastError — those are owned by the runner.
 */
export async function ensurePostgresBackupScheduledJob(
  prisma: ScheduledJobSeedClient,
  now: Date = new Date(),
): Promise<{ created: boolean }> {
  const nextRunAt = nextDailyRunAt(now);

  const existing = await prisma.scheduledJob.findUnique({
    where: { jobId: POSTGRES_BACKUP_JOB_ID },
    select: { jobId: true, nextRunAt: true },
  });

  if (existing) {
    await prisma.scheduledJob.update({
      where: { jobId: POSTGRES_BACKUP_JOB_ID },
      data: {
        name: POSTGRES_BACKUP_JOB_NAME,
        schedule: POSTGRES_BACKUP_SCHEDULE,
        nextRunAt: existing.nextRunAt ?? nextRunAt,
      },
    });
    return { created: false };
  }

  await prisma.scheduledJob.create({
    data: {
      jobId: POSTGRES_BACKUP_JOB_ID,
      name: POSTGRES_BACKUP_JOB_NAME,
      schedule: POSTGRES_BACKUP_SCHEDULE,
      nextRunAt,
    },
  });
  return { created: true };
}
