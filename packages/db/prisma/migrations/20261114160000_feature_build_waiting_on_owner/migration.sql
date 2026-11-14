-- BI-B6894001 slice 1: a needs-human escalation parks the build instead of
-- abandoning it. Nullable, no default: every existing build reads as not
-- parked, so this is safe against any data state. Re-runnable.
ALTER TABLE "FeatureBuild" ADD COLUMN IF NOT EXISTS "waitingOnOwnerSince" TIMESTAMP(3);
