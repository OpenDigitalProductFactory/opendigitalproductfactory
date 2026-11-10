-- Align the newly introduced CareRecord with the platform-wide record lifecycle
-- convention without rewriting the already committed expand migration.
ALTER TABLE "CareRecord"
  DROP CONSTRAINT "CareRecord_supersededById_fkey";

DROP INDEX "CareRecord_supersededById_key";
DROP INDEX "CareRecord_organizationId_kind_status_effectiveAt_idx";

ALTER TABLE "CareRecord"
  ADD COLUMN "lifecycle" "RecordLifecycle" NOT NULL DEFAULT 'active',
  ADD COLUMN "lifecycleAt" TIMESTAMP(3),
  ADD COLUMN "lifecycleReason" TEXT,
  ADD COLUMN "successorId" TEXT;

UPDATE "CareRecord"
SET
  "lifecycle" = CASE
    WHEN "status" = 'superseded' THEN 'superseded'::"RecordLifecycle"
    WHEN "status" = 'entered-in-error' THEN 'quarantined'::"RecordLifecycle"
    ELSE 'active'::"RecordLifecycle"
  END,
  "lifecycleAt" = CASE WHEN "status" = 'active' THEN NULL ELSE "recordedAt" END,
  "lifecycleReason" = CASE WHEN "status" = 'active' THEN NULL ELSE "correctionReason" END,
  "successorId" = "supersededById";

ALTER TABLE "CareRecord"
  DROP COLUMN "supersededById",
  DROP COLUMN "status";

DROP TYPE "CareRecordStatus";

CREATE UNIQUE INDEX "CareRecord_successorId_key" ON "CareRecord"("successorId");
CREATE INDEX "CareRecord_organizationId_kind_lifecycle_effectiveAt_idx" ON "CareRecord"("organizationId", "kind", "lifecycle", "effectiveAt");

ALTER TABLE "CareRecord"
  ADD CONSTRAINT "CareRecord_successorId_fkey"
  FOREIGN KEY ("successorId") REFERENCES "CareRecord"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE;
