/**
 * Backup mechanism identifier constants. Mirrored in
 * packages/db/src/seed-platform-backup.ts (which seeds the ScheduledJob row);
 * both files must agree on the jobId or the heartbeat will be orphaned.
 */
export const POSTGRES_BACKUP_JOB_ID = "postgres-daily-backup";
export const POSTGRES_BACKUP_JOB_NAME =
  "Postgres daily backup (platform-managed)";
export const POSTGRES_BACKUP_SCHEDULE = "daily";

export const NEO4J_BACKUP_JOB_ID = "neo4j-daily-backup";
export const NEO4J_BACKUP_JOB_NAME = "Neo4j daily backup (platform-managed)";
export const NEO4J_BACKUP_SCHEDULE = "daily";

export const QDRANT_BACKUP_JOB_ID = "qdrant-daily-backup";
export const QDRANT_BACKUP_JOB_NAME = "Qdrant daily backup (platform-managed)";
export const QDRANT_BACKUP_SCHEDULE = "daily";

/** Inngest events for manual triggers. */
export const POSTGRES_BACKUP_EVENT = "ops/postgres-backup.requested";
export const NEO4J_BACKUP_EVENT = "ops/neo4j-backup.requested";
export const QDRANT_BACKUP_EVENT = "ops/qdrant-backup.requested";

/** Cron expression — 03:00 UTC daily. */
export const POSTGRES_BACKUP_CRON = "0 3 * * *";
/** All-services daily backup cron — runs after Postgres (same schedule). */
export const ALL_BACKUPS_CRON = "0 3 * * *";

// ─── Trial-restore verification (BI-31C9FBDF) ────────────────────────────────
// Runs as the final step of allBackupsDailyScheduled after postgres + neo4j +
// qdrant backups complete; also exposed via a manual-trigger event so admins
// can re-verify on demand.

export const POSTGRES_TRIAL_RESTORE_JOB_ID = "postgres-trial-restore-daily";
export const POSTGRES_TRIAL_RESTORE_JOB_NAME =
  "Postgres trial-restore verification (platform-managed)";
export const POSTGRES_TRIAL_RESTORE_SCHEDULE = "daily";
export const POSTGRES_TRIAL_RESTORE_EVENT = "ops/postgres-trial-restore.requested";

/** Value written to BackupRestore.trigger for the nightly trial-verification path. */
export const TRIAL_RESTORE_TRIGGER = "trial-verification";

/**
 * Default list of critical tables to row-count-assert during trial restore.
 * The "> 0" check catches truncated dumps + write-during-snapshot corruption.
 * Comma-joined to match the ASSERT_TABLES env shape the shell script reads.
 */
export const TRIAL_RESTORE_DEFAULT_ASSERT_TABLES = [
  "BacklogItem",
  "Epic",
  "ModelProvider",
  "User",
] as const;
