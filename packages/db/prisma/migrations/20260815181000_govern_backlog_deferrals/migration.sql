-- Separate terminal retirement from still-wanted deferred work, then add the
-- active projection required to keep a deferral attributable and reviewable.
ALTER TABLE "BacklogItem"
  ADD COLUMN "deferReason" TEXT,
  ADD COLUMN "deferTrigger" TEXT,
  ADD COLUMN "deferReviewAt" TIMESTAMP(3),
  ADD COLUMN "deferOwnerPrincipalId" TEXT,
  ADD COLUMN "deferredAt" TIMESTAMP(3);

UPDATE "BacklogItem"
SET "status" = 'retired'
WHERE "status" = 'deferred'
  AND "triageOutcome" IN ('duplicate', 'discard');

ALTER TABLE "BacklogItem"
  ADD CONSTRAINT "BacklogItem_deferOwnerPrincipalId_fkey"
  FOREIGN KEY ("deferOwnerPrincipalId") REFERENCES "Principal"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;

CREATE INDEX "BacklogItem_status_deferReviewAt_idx"
  ON "BacklogItem"("status", "deferReviewAt");

CREATE INDEX "BacklogItem_deferOwnerPrincipalId_status_idx"
  ON "BacklogItem"("deferOwnerPrincipalId", "status");
