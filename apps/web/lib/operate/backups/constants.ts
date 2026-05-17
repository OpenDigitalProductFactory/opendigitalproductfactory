/**
 * Backup mechanism identifier constants. Mirrored in
 * packages/db/src/seed-platform-backup.ts (which seeds the ScheduledJob row);
 * both files must agree on the jobId or the heartbeat will be orphaned.
 */
export const POSTGRES_BACKUP_JOB_ID = "postgres-daily-backup";
export const POSTGRES_BACKUP_JOB_NAME =
  "Postgres daily backup (platform-managed)";
export const POSTGRES_BACKUP_SCHEDULE = "daily";

/** Inngest event the manual-trigger button emits. */
export const POSTGRES_BACKUP_EVENT = "ops/postgres-backup.requested";

/** Cron expression — 03:00 UTC daily. */
export const POSTGRES_BACKUP_CRON = "0 3 * * *";
