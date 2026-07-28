-- BI-69728276: durable FIFO admission for governed nonproduction environments.
-- Capacity remains one in this migration; the slot identity makes the existing
-- singleton invariant explicit before any later isolated-capacity pilot.

ALTER TABLE "NonProductionEnvironmentLease"
  ADD COLUMN "claimKey" TEXT,
  ADD COLUMN "slotKey" TEXT,
  ADD COLUMN "queuedAt" TIMESTAMP(3),
  ADD COLUMN "admittedAt" TIMESTAMP(3),
  ADD COLUMN "cancelledAt" TIMESTAMP(3),
  ADD COLUMN "heartbeatAt" TIMESTAMP(3),
  ADD COLUMN "phase" TEXT,
  ADD COLUMN "requestedTtlMs" INTEGER NOT NULL DEFAULT 900000;

UPDATE "NonProductionEnvironmentLease"
SET
  "queuedAt" = COALESCE("queuedAt", "createdAt"),
  "slotKey" = CASE
    WHEN "status" = 'active' THEN 'slot-0'
    ELSE "slotKey"
  END,
  "activeKey" = CASE
    WHEN "status" = 'active' THEN "environmentKey" || ':slot-0'
    ELSE NULL
  END,
  "admittedAt" = CASE
    WHEN "status" = 'active' THEN COALESCE("admittedAt", "createdAt")
    ELSE "admittedAt"
  END,
  "heartbeatAt" = CASE
    WHEN "status" = 'active' THEN COALESCE("heartbeatAt", "updatedAt")
    ELSE "heartbeatAt"
  END;

ALTER TABLE "NonProductionEnvironmentLease"
  ALTER COLUMN "status" SET DEFAULT 'queued';

-- @migration-safety: data-safe: claimKey is nullable and every existing row is
-- NULL, so PostgreSQL's UNIQUE index permits the full legacy data set.
CREATE UNIQUE INDEX "NonProductionEnvironmentLease_claimKey_key"
  ON "NonProductionEnvironmentLease"("claimKey");

CREATE INDEX "NonProductionEnvironmentLease_environmentKey_status_queuedAt_idx"
  ON "NonProductionEnvironmentLease"("environmentKey", "status", "queuedAt");
