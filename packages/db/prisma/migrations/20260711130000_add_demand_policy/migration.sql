-- EP-DEMAND-MGMT Phase 4: operator-owned demand-management policy on the
-- platform-dev singleton — the active scoring framework + org-wide default
-- investment-bucket target allocation the engine/board read instead of the
-- built-in defaults.
-- @migration-safety: data-safe: nullable additions to a singleton config row;
-- no existing row can violate any constraint.
ALTER TABLE "PlatformDevConfig" ADD COLUMN "demandFramework" TEXT;
ALTER TABLE "PlatformDevConfig" ADD COLUMN "demandBucketTargets" JSONB;
