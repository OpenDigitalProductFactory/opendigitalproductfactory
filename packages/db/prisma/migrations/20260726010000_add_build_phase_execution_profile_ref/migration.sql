-- @migration-safety: data-safe: adding a nullable JSONB column with no default or backfill cannot invalidate existing rows.
ALTER TABLE "BuildPhaseRun"
ADD COLUMN "executionProfileRef" JSONB;
