-- Postgres daily backup mechanism (Slice 1).
-- Spec: docs/superpowers/specs/2026-05-17-postgres-daily-backup-design.md
-- Plan: docs/superpowers/plans/2026-05-17-postgres-daily-backup-slice-1.md
--
-- BackupRun: per-run audit log surfaced in /admin/backups (history table).
-- BackupRestore: per-restore audit log (Slice 2 surfaces this in UI; Slice 1
--                creates the table so the FK from a future restore wizard
--                doesn't trip a migration ordering issue when Slice 2 lands).

CREATE TABLE "BackupRun" (
  "id"            TEXT NOT NULL,
  "target"        TEXT NOT NULL DEFAULT 'postgres',
  "startedAt"     TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "finishedAt"    TIMESTAMP(3),
  "status"        TEXT NOT NULL,
  "trigger"       TEXT NOT NULL,
  "schedule"      TEXT,
  "sizeBytes"     BIGINT,
  "durationMs"    INTEGER,
  "sha256"        TEXT,
  "pgVersion"     TEXT,
  "dpfVersion"    TEXT,
  "storagePath"   TEXT NOT NULL,
  "errorMessage"  TEXT,
  "prunedAt"      TIMESTAMP(3),
  "createdAt"     TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "BackupRun_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "BackupRun_startedAt_idx"        ON "BackupRun" ("startedAt");
CREATE INDEX "BackupRun_status_idx"           ON "BackupRun" ("status");
CREATE INDEX "BackupRun_target_status_idx"    ON "BackupRun" ("target", "status");

CREATE TABLE "BackupRestore" (
  "id"                    TEXT NOT NULL,
  "startedAt"             TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "finishedAt"            TIMESTAMP(3),
  "status"                TEXT NOT NULL,
  "initiatedByUserId"     TEXT,
  "sourceBackupRunId"     TEXT NOT NULL,
  "preRestoreBackupRunId" TEXT,
  "errorMessage"          TEXT,
  "createdAt"             TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "BackupRestore_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "BackupRestore_sourceBackupRunId_fkey"
    FOREIGN KEY ("sourceBackupRunId") REFERENCES "BackupRun" ("id")
    ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "BackupRestore_preRestoreBackupRunId_fkey"
    FOREIGN KEY ("preRestoreBackupRunId") REFERENCES "BackupRun" ("id")
    ON DELETE SET NULL ON UPDATE CASCADE
);

CREATE INDEX "BackupRestore_startedAt_idx" ON "BackupRestore" ("startedAt");
CREATE INDEX "BackupRestore_status_idx"    ON "BackupRestore" ("status");
