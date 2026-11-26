-- Preserve retirement history while moving to the shared lifecycle convention.
ALTER TABLE "ExecutionHost" RENAME COLUMN "retiredAt" TO "lifecycleAt";
ALTER TABLE "ExecutionHost"
  ADD COLUMN "lifecycle" "RecordLifecycle" NOT NULL DEFAULT 'active';

UPDATE "ExecutionHost"
SET "lifecycle" = 'retired'
WHERE "lifecycleAt" IS NOT NULL;

CREATE INDEX "ExecutionHost_installationRef_lifecycle_idx"
  ON "ExecutionHost"("installationRef", "lifecycle");
DROP INDEX "ExecutionHost_installationRef_retiredAt_idx";
