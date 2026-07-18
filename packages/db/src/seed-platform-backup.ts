import type { PrismaClient } from "../generated/client/client";

/**
 * Schedule + identifier constants for the platform-managed backups.
 *
 * Spec: docs/superpowers/specs/2026-05-17-postgres-daily-backup-design.md
 * Spec: docs/superpowers/specs/2026-05-18-postgres-backup-slice-3-neo4j-qdrant.md
 *
 * The ScheduledJob rows are live heartbeats surfaced in /admin/backups.
 * The same identifiers are duplicated (intentionally — packages/db cannot
 * import from apps/web) in apps/web/lib/operate/backups/constants.ts.
 * If you change one, change both, or the heartbeat row will be orphaned.
 */
export const POSTGRES_BACKUP_JOB_ID = "postgres-daily-backup";
export const POSTGRES_BACKUP_JOB_NAME =
  "Postgres daily backup (platform-managed)";
export const POSTGRES_BACKUP_SCHEDULE = "daily";

export const NEO4J_BACKUP_JOB_ID = "neo4j-daily-backup";
export const QDRANT_BACKUP_JOB_ID = "qdrant-daily-backup";

// BI-31C9FBDF: trial-restore verification (postgres only in slice 1).
export const POSTGRES_TRIAL_RESTORE_JOB_ID = "postgres-trial-restore-daily";
export const POSTGRES_TRIAL_RESTORE_JOB_NAME =
  "Postgres trial-restore verification (platform-managed)";
export const POSTGRES_TRIAL_RESTORE_SCHEDULE = "daily";

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

async function ensureBackupScheduledJob(
  prisma: ScheduledJobSeedClient,
  jobId: string,
  name: string,
  schedule: string,
  now: Date,
): Promise<{ created: boolean }> {
  const nextRunAt = nextDailyRunAt(now);

  const existing = await prisma.scheduledJob.findUnique({
    where: { jobId },
    select: { jobId: true, nextRunAt: true },
  });

  if (existing) {
    await prisma.scheduledJob.update({
      where: { jobId },
      data: {
        name,
        schedule,
        enabled: true,
        nextRunAt: existing.nextRunAt ?? nextRunAt,
      },
    });
    return { created: false };
  }

  await prisma.scheduledJob.create({
    data: { jobId, name, schedule, enabled: true, nextRunAt },
  });
  return { created: true };
}

/**
 * Idempotent: create the Postgres ScheduledJob heartbeat row if missing;
 * update name/schedule/nextRunAt on every seed run. Does not clobber
 * lastRunAt / lastStatus / lastError — those are owned by the runner.
 */
export async function ensurePostgresBackupScheduledJob(
  prisma: ScheduledJobSeedClient,
  now: Date = new Date(),
): Promise<{ created: boolean }> {
  return ensureBackupScheduledJob(
    prisma,
    POSTGRES_BACKUP_JOB_ID,
    POSTGRES_BACKUP_JOB_NAME,
    POSTGRES_BACKUP_SCHEDULE,
    now,
  );
}

/** BI-31C9FBDF: trial-restore verification heartbeat row. */
export async function ensurePostgresTrialRestoreScheduledJob(
  prisma: ScheduledJobSeedClient,
  now: Date = new Date(),
): Promise<{ created: boolean }> {
  return ensureBackupScheduledJob(
    prisma,
    POSTGRES_TRIAL_RESTORE_JOB_ID,
    POSTGRES_TRIAL_RESTORE_JOB_NAME,
    POSTGRES_TRIAL_RESTORE_SCHEDULE,
    now,
  );
}

/** Convenience: ensure all backup + verification scheduled jobs exist in one call. */
export async function ensureAllBackupScheduledJobs(
  prisma: ScheduledJobSeedClient,
  now: Date = new Date(),
): Promise<{
  postgres: { created: boolean };
  postgresTrialRestore: { created: boolean };
  supersededDeactivated: number;
}> {
  const [postgres, postgresTrialRestore, superseded] = await Promise.all([
    ensureBackupScheduledJob(prisma, POSTGRES_BACKUP_JOB_ID, POSTGRES_BACKUP_JOB_NAME, POSTGRES_BACKUP_SCHEDULE, now),
    ensureBackupScheduledJob(prisma, POSTGRES_TRIAL_RESTORE_JOB_ID, POSTGRES_TRIAL_RESTORE_JOB_NAME, POSTGRES_TRIAL_RESTORE_SCHEDULE, now),
    prisma.scheduledJob.updateMany({
      where: { jobId: { in: [NEO4J_BACKUP_JOB_ID, QDRANT_BACKUP_JOB_ID] } },
      data: { enabled: false, nextRunAt: null },
    }),
  ]);
  return { postgres, postgresTrialRestore, supersededDeactivated: superseded.count };
}
