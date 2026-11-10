-- BI-3FD07259: preserve a durable admission identity before queue dispatch.
-- Historical SelfUpgradeRun rows intentionally retain NULL dispatchStatus and
-- admissionFingerprint; they are audit history and are not reconciliation
-- candidates. New code writes the complete admission contract atomically.

CREATE TYPE "SelfUpgradeDispatchStatus" AS ENUM (
  'admission_pending',
  'dispatching',
  'dispatched',
  'indeterminate',
  'dispatch_failed'
);

ALTER TABLE "SelfUpgradeRun"
  ADD COLUMN "targetTag" TEXT,
  ADD COLUMN "requestedForce" BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN "dryRun" BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN "routine" BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN "admissionFingerprint" TEXT,
  ADD COLUMN "dispatchStatus" "SelfUpgradeDispatchStatus",
  ADD COLUMN "dispatchAttemptCount" INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN "dispatchLeaseToken" TEXT,
  ADD COLUMN "dispatchLeaseExpiresAt" TIMESTAMP(3),
  ADD COLUMN "dispatchEventIds" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
  ADD COLUMN "dispatchAttemptedAt" TIMESTAMP(3),
  ADD COLUMN "dispatchAcknowledgedAt" TIMESTAMP(3),
  ADD COLUMN "dispatchError" TEXT;

CREATE INDEX "SelfUpgradeRun_dispatchStatus_dispatchLeaseExpiresAt_idx"
  ON "SelfUpgradeRun"("dispatchStatus", "dispatchLeaseExpiresAt");
CREATE INDEX "SelfUpgradeRun_admissionFingerprint_idx"
  ON "SelfUpgradeRun"("admissionFingerprint");
