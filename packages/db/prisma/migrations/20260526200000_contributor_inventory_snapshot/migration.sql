-- BI-063BDF1B (EP-REDUCTION-GEAR-ARCH): Contributor inventory sync substrate.
-- Spec: docs/superpowers/specs/2026-05-26-contributor-inventory-sync-design.md
--
-- Adds:
--   - metadata column on ScheduledJob for per-job durable scratch state
--     (used by jobId="contributor-inventory-sync" for GitHub etag persistence)
--   - ContributorInventorySyncRun: per-run audit (mirrors BackupRun)
--   - ContributorInventorySnapshot: per-source inventory rows (FK to sync run,
--     ON DELETE CASCADE so the retention sweep deletes the run row and its
--     snapshot rows atomically)

-- 1. metadata column on ScheduledJob.
ALTER TABLE "ScheduledJob"
  ADD COLUMN "metadata" JSONB;

-- 2. ContributorInventorySyncRun — per-run audit row.
CREATE TABLE "ContributorInventorySyncRun" (
  "id"              TEXT NOT NULL,
  "syncRunId"       TEXT NOT NULL,
  "startedAt"       TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "completedAt"     TIMESTAMP(3),
  "status"          TEXT NOT NULL DEFAULT 'running',
  "perSourceResult" JSONB NOT NULL DEFAULT '{}',
  "triggeredBy"     TEXT NOT NULL DEFAULT 'cron',
  "durationMs"      INTEGER,

  CONSTRAINT "ContributorInventorySyncRun_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "ContributorInventorySyncRun_syncRunId_key"
  ON "ContributorInventorySyncRun"("syncRunId");
CREATE INDEX "ContributorInventorySyncRun_startedAt_idx"
  ON "ContributorInventorySyncRun"("startedAt");
CREATE INDEX "ContributorInventorySyncRun_status_startedAt_idx"
  ON "ContributorInventorySyncRun"("status", "startedAt");

-- 3. ContributorInventorySnapshot — one row per inventory item per sync run.
CREATE TABLE "ContributorInventorySnapshot" (
  "id"        TEXT NOT NULL,
  "source"    TEXT NOT NULL,
  "sourceKey" TEXT NOT NULL,
  "payload"   JSONB NOT NULL,
  "syncRunId" TEXT NOT NULL,
  "fetchedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "ContributorInventorySnapshot_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "ContributorInventorySnapshot_source_sourceKey_syncRunId_key"
  ON "ContributorInventorySnapshot"("source", "sourceKey", "syncRunId");
CREATE INDEX "ContributorInventorySnapshot_source_syncRunId_idx"
  ON "ContributorInventorySnapshot"("source", "syncRunId");
CREATE INDEX "ContributorInventorySnapshot_source_fetchedAt_idx"
  ON "ContributorInventorySnapshot"("source", "fetchedAt");

-- 4. FK with ON DELETE CASCADE: deleting a sync run deletes its rows.
ALTER TABLE "ContributorInventorySnapshot"
  ADD CONSTRAINT "ContributorInventorySnapshot_syncRunId_fkey"
    FOREIGN KEY ("syncRunId")
    REFERENCES "ContributorInventorySyncRun"("syncRunId")
    ON DELETE CASCADE
    ON UPDATE CASCADE;
