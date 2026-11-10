-- Index the FK columns the Estate Discovery retention purge cascades through.
--
-- Symptom (observed on this operator install, 2026-09-14): the nightly
-- 04:00 UTC data-retention sweep pinned two CPU cores for 74+ minutes and
-- deleted ZERO rows. A 10s probe of the stuck backend measured 7,290,129 buffer
-- blocks touched and n_tup_del unchanged.
--
-- Cause: DiscoveredRelationship carries two ON DELETE CASCADE FKs to
-- DiscoveredItem (fromDiscoveredItemId, toDiscoveredItemId) and NEITHER was
-- indexed. Postgres must find referencing children before it may delete a
-- parent, so every single deleted DiscoveredItem row seq-scanned the entire
-- 566k-row / 31,506-block DiscoveredRelationship table TWICE. Measured rate:
-- ~231 full scans of that table per 10 seconds, ~11.5 items deleted/sec. The
-- 90,537 rows eligible under the declared 30d window would have needed ~2.2
-- hours, so the sweep timed out every night and the raw log grew unbounded --
-- the exact failure the model's @dpf retention tag exists to prevent
-- (see BI-BFFB9211).
--
-- InventoryEntity/InventoryRelationship.lastConfirmedRunId are the same defect
-- class (ON DELETE SET NULL from DiscoveryRun, unindexed) at a far smaller
-- scale today (~1,000 blocks each). Indexed here so they cannot become the next
-- incident as the estate grows.
--
-- @migration-safety: data-safe: purely additive. Creates four btree indexes and
-- alters no column, constraint or row. No backfill, no data movement, nothing
-- tightened -- no existing row can violate a constraint that did not already
-- apply to it, so this applies cleanly against any data state.
--
-- IF NOT EXISTS is deliberate: this install is actively stalling on the missing
-- indexes, so an operator may pre-create them (CONCURRENTLY, outside a
-- migration) for immediate relief. This migration must then be a no-op rather
-- than fail with 42P07 -- it stays the source of truth for a fresh install.
--
-- Lock note: plain CREATE INDEX (not CONCURRENTLY) because Prisma runs each
-- migration inside a transaction and CONCURRENTLY cannot run there. Each takes
-- a SHARE lock that blocks WRITES to that table only for the build. The largest
-- is DiscoveredRelationship at 414 MB / 566k rows -- a seconds-long build, and
-- discovery ingest is retried by design, so a brief write block is safe.

CREATE INDEX IF NOT EXISTS "DiscoveredRelationship_fromDiscoveredItemId_idx"
  ON "DiscoveredRelationship"("fromDiscoveredItemId");

CREATE INDEX IF NOT EXISTS "DiscoveredRelationship_toDiscoveredItemId_idx"
  ON "DiscoveredRelationship"("toDiscoveredItemId");

CREATE INDEX IF NOT EXISTS "InventoryEntity_lastConfirmedRunId_idx"
  ON "InventoryEntity"("lastConfirmedRunId");

CREATE INDEX IF NOT EXISTS "InventoryRelationship_lastConfirmedRunId_idx"
  ON "InventoryRelationship"("lastConfirmedRunId");
