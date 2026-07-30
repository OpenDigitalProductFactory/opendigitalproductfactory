-- @migration-safety: data-safe: nullable capability metadata leaves every
-- existing lease on the legacy singleton-compatible path.
ALTER TABLE "NonProductionEnvironmentLease"
ADD COLUMN "slotManifestVersion" INTEGER;
