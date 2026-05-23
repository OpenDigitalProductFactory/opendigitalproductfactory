-- McpApiToken: add buildId + kind for per-build ephemeral ship-phase tokens
-- (BI-9866659C AC #4). Additive only — existing rows backfill cleanly:
--   * `kind` defaults to "operator" (matches today's only token kind)
--   * `buildId` defaults to NULL (operator-owned tokens have no build linkage)
-- No data migration required; FeatureBuild has no existing relationship to
-- McpApiToken, and we intentionally model buildId as a loose FK (not a
-- Prisma relation) so a build deletion doesn't cascade-delete the audit row.

ALTER TABLE "McpApiToken"
  ADD COLUMN "kind"    TEXT NOT NULL DEFAULT 'operator',
  ADD COLUMN "buildId" TEXT;

-- Used by transitionBuildPhase()'s ship-exit hook to find all active
-- ephemeral tokens for a given buildId in one indexed lookup.
CREATE INDEX "McpApiToken_buildId_revokedAt_idx"
  ON "McpApiToken"("buildId", "revokedAt");
