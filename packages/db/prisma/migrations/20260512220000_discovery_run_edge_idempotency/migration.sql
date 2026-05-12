-- DiscoveryRun.runKey uniqueness retrofit for Edge Node idempotency.
--
-- The original schema enforced runKey uniqueness globally:
--   CREATE UNIQUE INDEX "DiscoveryRun_runKey_key" ON "DiscoveryRun"("runKey");
--
-- The Edge Node spec's "REST ingestion controls (Phase 0)" section
-- (docs/superpowers/specs/2026-05-09-dpf-edge-node-design.md, finalized
-- in PR #509) requires per-(edgeNodeId, runKey) uniqueness:
--
--   "First submission with a given (edgeNodeId, runKey) is persisted
--    normally. Re-submission of the same pair returns the prior
--    result snapshot — idempotent. Submission with a runKey already
--    used by a different edgeNodeId is silent: each node has its own
--    runKey namespace."
--
-- This migration:
--   1. Drops the global runKey unique constraint
--   2. Adds a composite unique constraint on (edgeNodeId, runKey)
--      so each Edge Node owns its own runKey namespace
--   3. Adds a partial unique index on runKey WHERE edgeNodeId IS NULL
--      so bootstrap-discovery runs (no Edge Node attribution) retain
--      global runKey uniqueness for free
--
-- All existing rows survive: pre-Phase-0 bootstrap runs have
-- edgeNodeId = NULL and runKey values like "DISC-<timestamp>", so
-- the partial unique index admits them. No row movement; index swap
-- only.

-- DropIndex
DROP INDEX "DiscoveryRun_runKey_key";

-- CreateIndex (composite for Edge Node idempotency)
CREATE UNIQUE INDEX "DiscoveryRun_edgeNodeId_runKey_key" ON "DiscoveryRun"("edgeNodeId", "runKey");

-- CreateIndex (partial unique for the bootstrap path — edgeNodeId IS NULL).
-- Postgres partial unique index: enforces uniqueness on runKey ONLY
-- for rows where edgeNodeId IS NULL. Edge Node rows (edgeNodeId NOT NULL)
-- are unaffected by this index and are governed by the composite above.
CREATE UNIQUE INDEX "DiscoveryRun_runKey_bootstrap_key"
  ON "DiscoveryRun"("runKey")
  WHERE "edgeNodeId" IS NULL;
