-- BI-9F7192F9 phase 1: the retained S5 rehearsal requester enrollment record.
-- One row per owner-enrolled synthetic requester for one S5 rehearsal setup.
-- Facts are immutable; the only lifecycle transition is active -> retired,
-- written once; rows cannot be deleted (the record is the single durable
-- marker that a User/Principal is a governed requester). Guards follow the
-- care-evidence precedent (20260717035500).
-- Additive: a new enum, a new empty table, its indexes, foreign keys, CHECK
-- and triggers. No backfill. Down (manual, only before any row exists):
--   DROP TABLE "S5RehearsalRequesterEnrollment"; DROP TYPE "S5RehearsalRequesterRetirementReason";
--   DROP FUNCTION s5_rehearsal_requester_enrollment_guard_update(); DROP FUNCTION s5_rehearsal_requester_enrollment_guard_delete();
-- @migration-safety: data-safe: every constraint targets the table created in this migration, which starts empty.
-- CreateEnum
CREATE TYPE "S5RehearsalRequesterRetirementReason" AS ENUM ('rehearsal_complete', 'quarantine_after_failure', 'setup_superseded', 'operator_cleanup');

-- CreateTable
CREATE TABLE "S5RehearsalRequesterEnrollment" (
    "id" TEXT NOT NULL,
    "setupDigest" TEXT NOT NULL,
    "rulingRef" TEXT NOT NULL,
    "reservationRef" TEXT NOT NULL,
    "attemptRef" TEXT NOT NULL,
    "fixtureRef" TEXT NOT NULL,
    "installationRef" TEXT NOT NULL,
    "leaseRef" TEXT NOT NULL,
    "dbIdentityRef" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "principalId" TEXT NOT NULL,
    "enrolledByPrincipalId" TEXT NOT NULL,
    "enrolledAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lifecycle" "RecordLifecycle" NOT NULL DEFAULT 'active',
    "lifecycleAt" TIMESTAMP(3),
    "retirementReason" "S5RehearsalRequesterRetirementReason",
    "retiredByPrincipalId" TEXT,

    CONSTRAINT "S5RehearsalRequesterEnrollment_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "S5RehearsalRequesterEnrollment_setupDigest_key" ON "S5RehearsalRequesterEnrollment"("setupDigest");

-- CreateIndex
CREATE UNIQUE INDEX "S5RehearsalRequesterEnrollment_userId_key" ON "S5RehearsalRequesterEnrollment"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "S5RehearsalRequesterEnrollment_principalId_key" ON "S5RehearsalRequesterEnrollment"("principalId");

-- CreateIndex
CREATE INDEX "S5RehearsalRequesterEnrollment_enrolledByPrincipalId_idx" ON "S5RehearsalRequesterEnrollment"("enrolledByPrincipalId");

-- CreateIndex
CREATE INDEX "S5RehearsalRequesterEnrollment_retiredByPrincipalId_idx" ON "S5RehearsalRequesterEnrollment"("retiredByPrincipalId");

-- AddForeignKey
ALTER TABLE "S5RehearsalRequesterEnrollment" ADD CONSTRAINT "S5RehearsalRequesterEnrollment_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "S5RehearsalRequesterEnrollment" ADD CONSTRAINT "S5RehearsalRequesterEnrollment_principalId_fkey" FOREIGN KEY ("principalId") REFERENCES "Principal"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "S5RehearsalRequesterEnrollment" ADD CONSTRAINT "S5RehearsalRequesterEnrollment_enrolledByPrincipalId_fkey" FOREIGN KEY ("enrolledByPrincipalId") REFERENCES "Principal"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "S5RehearsalRequesterEnrollment" ADD CONSTRAINT "S5RehearsalRequesterEnrollment_retiredByPrincipalId_fkey" FOREIGN KEY ("retiredByPrincipalId") REFERENCES "Principal"("id") ON DELETE RESTRICT ON UPDATE CASCADE;


-- Lifecycle tuple: all-or-none. Active rows carry no terminal fields; retired
-- rows carry all three. No other RecordLifecycle value is allowed.
ALTER TABLE "S5RehearsalRequesterEnrollment" ADD CONSTRAINT "S5RehearsalRequesterEnrollment_lifecycle_tuple_check" CHECK (
  ("lifecycle" = 'active' AND "lifecycleAt" IS NULL AND "retirementReason" IS NULL AND "retiredByPrincipalId" IS NULL)
  OR ("lifecycle" = 'retired' AND "lifecycleAt" IS NOT NULL AND "retirementReason" IS NOT NULL AND "retiredByPrincipalId" IS NOT NULL)
);

-- Guards (idempotent: CREATE OR REPLACE and DROP TRIGGER IF EXISTS).
CREATE OR REPLACE FUNCTION s5_rehearsal_requester_enrollment_guard_update()
RETURNS TRIGGER AS $$
BEGIN
  IF OLD."id" IS DISTINCT FROM NEW."id"
    OR OLD."setupDigest" IS DISTINCT FROM NEW."setupDigest"
    OR OLD."rulingRef" IS DISTINCT FROM NEW."rulingRef"
    OR OLD."reservationRef" IS DISTINCT FROM NEW."reservationRef"
    OR OLD."attemptRef" IS DISTINCT FROM NEW."attemptRef"
    OR OLD."fixtureRef" IS DISTINCT FROM NEW."fixtureRef"
    OR OLD."installationRef" IS DISTINCT FROM NEW."installationRef"
    OR OLD."leaseRef" IS DISTINCT FROM NEW."leaseRef"
    OR OLD."dbIdentityRef" IS DISTINCT FROM NEW."dbIdentityRef"
    OR OLD."userId" IS DISTINCT FROM NEW."userId"
    OR OLD."principalId" IS DISTINCT FROM NEW."principalId"
    OR OLD."enrolledByPrincipalId" IS DISTINCT FROM NEW."enrolledByPrincipalId"
    OR OLD."enrolledAt" IS DISTINCT FROM NEW."enrolledAt"
  THEN
    RAISE EXCEPTION 'S5RehearsalRequesterEnrollment facts are immutable';
  END IF;
  IF NOT (OLD."lifecycle" = 'active' AND NEW."lifecycle" = 'retired') THEN
    RAISE EXCEPTION 'S5RehearsalRequesterEnrollment lifecycle may only move from active to retired, once';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE OR REPLACE FUNCTION s5_rehearsal_requester_enrollment_guard_delete()
RETURNS TRIGGER AS $$
BEGIN
  RAISE EXCEPTION 'S5RehearsalRequesterEnrollment is retained and cannot be deleted';
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS "S5RehearsalRequesterEnrollment_guard_update" ON "S5RehearsalRequesterEnrollment";
CREATE TRIGGER "S5RehearsalRequesterEnrollment_guard_update"
  BEFORE UPDATE ON "S5RehearsalRequesterEnrollment"
  FOR EACH ROW EXECUTE FUNCTION s5_rehearsal_requester_enrollment_guard_update();

DROP TRIGGER IF EXISTS "S5RehearsalRequesterEnrollment_guard_delete" ON "S5RehearsalRequesterEnrollment";
CREATE TRIGGER "S5RehearsalRequesterEnrollment_guard_delete"
  BEFORE DELETE ON "S5RehearsalRequesterEnrollment"
  FOR EACH ROW EXECUTE FUNCTION s5_rehearsal_requester_enrollment_guard_delete();
