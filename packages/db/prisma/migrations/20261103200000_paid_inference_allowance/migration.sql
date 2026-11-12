-- BI-F3B6713F / DI-666409F895C5: owner-set installation allowance for paid inference.
-- @migration-safety: data-safe: four nullable columns, one nullable FK and its index, no
-- default or backfill. Existing rows read as "not set", so the registry
-- per-agent caps keep applying until an owner records an allowance.
BEGIN;
SET LOCAL lock_timeout = '5s';

ALTER TABLE "PlatformDevConfig"
  ADD COLUMN "paidInferenceDailyUsdAllowance" DECIMAL(12,2),
  ADD COLUMN "paidInferenceAllowanceReason" TEXT,
  ADD COLUMN "paidInferenceAllowanceSetAt" TIMESTAMP(3),
  ADD COLUMN "paidInferenceAllowanceSetById" TEXT;

ALTER TABLE "PlatformDevConfig"
  ADD CONSTRAINT "PlatformDevConfig_paidInferenceAllowanceSetById_fkey"
  FOREIGN KEY ("paidInferenceAllowanceSetById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- Singleton table; the index satisfies FK index coverage for user deletion (ON DELETE SET NULL).
CREATE INDEX "PlatformDevConfig_paidInferenceAllowanceSetById_idx" ON "PlatformDevConfig"("paidInferenceAllowanceSetById");

COMMIT;
