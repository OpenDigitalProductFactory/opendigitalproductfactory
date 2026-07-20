-- BI-E07FEB3A — restore agreement between the PlatformConfig heap and its
-- canonical unique key index. Affected installs can hold duplicate heap rows
-- even while pg_index reports the btree healthy.
--
-- Fleet safety: the most recently updated value remains active; older rows are
-- quarantined by key, never deleted. IDs, values, and timestamps are preserved.
-- Clean installs change no data; the migration is idempotent and fails closed.

BEGIN;

SET LOCAL enable_indexscan = off;
SET LOCAL enable_indexonlyscan = off;
SET LOCAL enable_bitmapscan = off;

DO $$
DECLARE
  duplicate_row RECORD;
  quarantine_key TEXT;
BEGIN
  FOR duplicate_row IN
    WITH ranked AS MATERIALIZED (
      SELECT
        id,
        key,
        row_number() OVER (
          PARTITION BY key
          ORDER BY "updatedAt" DESC, id DESC
        ) AS duplicate_rank
      FROM "PlatformConfig"
    )
    SELECT id, key
    FROM ranked
    WHERE duplicate_rank > 1
    ORDER BY key, id
  LOOP
    quarantine_key := '__dpf_quarantined__' || duplicate_row.id || '__' || duplicate_row.key;
    WHILE EXISTS (
      SELECT 1 FROM "PlatformConfig"
      WHERE key = quarantine_key AND id <> duplicate_row.id
    ) LOOP
      quarantine_key := quarantine_key || '_';
    END LOOP;

    UPDATE "PlatformConfig" SET key = quarantine_key WHERE id = duplicate_row.id;
  END LOOP;
END $$;

DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM "PlatformConfig" GROUP BY key HAVING count(*) > 1
  ) THEN
    RAISE EXCEPTION 'PlatformConfig integrity repair left duplicate keys';
  END IF;
END $$;

DROP INDEX IF EXISTS "PlatformConfig_key_key";
CREATE UNIQUE INDEX "PlatformConfig_key_key" ON "PlatformConfig" (key);

COMMIT;
