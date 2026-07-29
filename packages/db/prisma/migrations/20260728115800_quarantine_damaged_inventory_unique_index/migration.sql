-- BI-193D851D: the observation-snapshot rewrite (20260728115900) forces a
-- non-HOT version of every InventoryEntity row, re-inserting entries into the
-- collation-damaged unique index (BI-CF4ADDAC). _bt_check_unique then rejects
-- heap duplicates the damaged index never caught, aborting the self-upgrade
-- with P3018/23505 one migration BEFORE the repair (20260728130000) that
-- converges those duplicates. When heap duplicates exist the index is already
-- untrustworthy: drop it here so the snapshot and repair can run. The repair
-- migration rebuilds, REINDEXes, and amcheck-validates it unconditionally, so
-- every install ends in the identical state.
--
-- On installs that already applied the full 2026-07-28 inventory chain this
-- runs later, finds no duplicates, and is a no-op. The duplicate probe must
-- not consult the damaged index, so index access is disabled for this
-- transaction.

SET lock_timeout = '30s';
LOCK TABLE "InventoryEntity" IN SHARE ROW EXCLUSIVE MODE;

SET LOCAL enable_indexscan = off;
SET LOCAL enable_indexonlyscan = off;
SET LOCAL enable_bitmapscan = off;

DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM "InventoryEntity"
    GROUP BY "entityKey"
    HAVING count(*) > 1
  ) THEN
    DROP INDEX IF EXISTS "InventoryEntity_entityKey_key";
  END IF;
END $$;
