-- Real remaining-weekly-allocation signal on CliPoolStatus.
-- Replaces the exhaustion-only proxy for the capacity-drain policy with the
-- provider's own weekly quota number (Anthropic unified-7d headers / oauth
-- usage, or codex account/rateLimits/read). Additive + nullable = fleet-safe:
-- existing rows and the deployed machinery keep working with these unset.

ALTER TABLE "CliPoolStatus" ADD COLUMN IF NOT EXISTS "weeklyUtilization" DOUBLE PRECISION;
ALTER TABLE "CliPoolStatus" ADD COLUMN IF NOT EXISTS "weeklyResetAt" TIMESTAMP(3);
ALTER TABLE "CliPoolStatus" ADD COLUMN IF NOT EXISTS "weeklySource" TEXT;
ALTER TABLE "CliPoolStatus" ADD COLUMN IF NOT EXISTS "weeklyObservedAt" TIMESTAMP(3);
