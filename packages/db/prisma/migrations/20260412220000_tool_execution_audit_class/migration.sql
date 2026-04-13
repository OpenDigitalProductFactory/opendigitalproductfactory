-- Phase 3: Add auditClass, capabilityId, and summary columns to ToolExecution.
-- Nullable — existing rows are left as NULL; backfill runs separately via
-- packages/db/src/backfill-capability-ids.ts after deploy.

ALTER TABLE "ToolExecution"
  ADD COLUMN IF NOT EXISTS "auditClass"   TEXT,
  ADD COLUMN IF NOT EXISTS "capabilityId" TEXT,
  ADD COLUMN IF NOT EXISTS "summary"      TEXT;

CREATE INDEX IF NOT EXISTS "ToolExecution_auditClass_createdAt_idx"
  ON "ToolExecution" ("auditClass", "createdAt" DESC);

CREATE INDEX IF NOT EXISTS "ToolExecution_capabilityId_createdAt_idx"
  ON "ToolExecution" ("capabilityId", "createdAt" DESC);
