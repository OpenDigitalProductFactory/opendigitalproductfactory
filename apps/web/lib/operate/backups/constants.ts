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
