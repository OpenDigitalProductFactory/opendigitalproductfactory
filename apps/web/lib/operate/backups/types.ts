/**
 * Shared types for the platform-managed backup mechanism.
 *
 * Spec: docs/superpowers/specs/2026-05-17-postgres-daily-backup-design.md
 * Spec: docs/superpowers/specs/2026-05-18-postgres-backup-slice-3-neo4j-qdrant.md
 */

/**
 * Trigger discriminator on BackupRun.
 *
 * `scheduled` / `manual` come from Slice 1 (cron + manual button).
 * `pre-restore-safety` is added by Slice 2: every restore writes a safety
 * dump first, recorded as a BackupRun row so it shows up in history and is
 * subject to the same GFS retention as any other successful backup.
 */
export type BackupTrigger = "scheduled" | "manual" | "pre-restore-safety";
export type BackupRunStatus = "running" | "ok" | "failed";
export type BackupTarget = "postgres" | "neo4j" | "qdrant";

/** GFS retention policy. Tunable via Platform Config in a later slice. */
export interface BackupRetentionPolicy {
  /** Number of most-recent daily-trigger runs to keep unconditionally. */
  daily: number;
  /** Number of weekly bucket entries (one per ISO week, most recent kept). */
  weekly: number;
  /** Number of monthly bucket entries (one per calendar month, most recent kept). */
  monthly: number;
}

export const DEFAULT_BACKUP_RETENTION: BackupRetentionPolicy = {
  daily: 7,
  weekly: 4,
  monthly: 12,
};

/**
 * Sidecar manifest written by scripts/backup-postgres.sh. The TS orchestrator
 * reads this back to populate the BackupRun row.
 */
export interface BackupManifest {
  schemaVersion: 1;
  target: "postgres";
  container: string;
  postgresUser: string;
  postgresDb: string;
  pgVersion: string;
  dpfVersion: string;
  startedAt: string;
  finishedAt: string;
  durationMs: number;
  sizeBytes: number;
  sha256: string;
  dumpFormat: string;
}

/** Sidecar manifest written by scripts/backup-neo4j.sh. */
export interface Neo4jBackupManifest {
  schemaVersion: 1;
  target: "neo4j";
  container: string;
  volume: string;
  database: string;
  image: string;
  startedAt: string;
  finishedAt: string;
  durationMs: number;
  sizeBytes: number;
  sha256: string;
  dumpFormat: string;
}

/** Sidecar manifest written by scripts/backup-qdrant.sh. */
export interface QdrantBackupManifest {
  schemaVersion: 1;
  target: "qdrant";
  qdrantUrl: string;
  snapshotName: string;
  startedAt: string;
  finishedAt: string;
  durationMs: number;
  sizeBytes: number;
  sha256: string;
  dumpFormat: string;
}

export interface ReadinessSummary {
  target: BackupTarget;
  scheduledJob: {
    jobId: string;
    schedule: string;
    nextRunAt: string | null;
    lastRunAt: string | null;
    lastStatus: string | null;
    lastError: string | null;
  } | null;
  lastRun: {
    id: string;
    status: BackupRunStatus;
    startedAt: string;
    finishedAt: string | null;
    sizeBytes: number | null;
    durationMs: number | null;
    trigger: BackupTrigger;
  } | null;
  lastSuccess: {
    id: string;
    finishedAt: string | null;
    sizeBytes: number | null;
    sha256: string | null;
  } | null;
  retention: BackupRetentionPolicy;
  retainedCount: number;
  retainedBytes: number;
  storagePath: string;
  failuresInLastThreeRuns: number;
  /**
   * Trial-restore verification status (BI-A8C149C1; trigger='trial-verification'
   * BackupRestore rows from BI-31C9FBDF). Null when no trial restore has ever
   * been recorded for this target (e.g. fresh install, OR a target whose trial
   * restore isn't implemented yet — neo4j + qdrant are slice-2 territory).
   * Used by the admin backup-health card to surface "trial restore last
   * passed <ts>" alongside the backup status.
   */
  trialRestore: {
    lastRunId: string;
    lastStatus: "ok" | "failed";
    lastStartedAt: string;
    lastFinishedAt: string | null;
    lastError: string | null;
  } | null;
}
