-- BI-2296E46C — restore agreement between the PortfolioQualityIssue heap and
-- its canonical issue-key index. Affected installs can hold duplicate heap
-- rows even while pg_index reports the btree healthy.
--
-- Fleet safety: the latest observation remains active; older rows are
-- quarantined by issueKey, never deleted. IDs, issue contents, timestamps,
-- and inbound references are preserved. Clean installs change no data; the
-- migration is idempotent and fails closed.

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
        "issueKey",
        row_number() OVER (
          PARTITION BY "issueKey"
          ORDER BY "lastDetectedAt" DESC, "firstDetectedAt" DESC, id DESC
        ) AS duplicate_rank
      FROM "PortfolioQualityIssue"
    )
    SELECT id, "issueKey"
    FROM ranked
    WHERE duplicate_rank > 1
    ORDER BY "issueKey", id
  LOOP
    quarantine_key := '__dpf_quarantined__' || duplicate_row.id || '__' || duplicate_row."issueKey";
    WHILE EXISTS (
      SELECT 1
      FROM "PortfolioQualityIssue"
      WHERE "issueKey" = quarantine_key AND id <> duplicate_row.id
    ) LOOP
      quarantine_key := quarantine_key || '_';
    END LOOP;

    UPDATE "PortfolioQualityIssue"
    SET "issueKey" = quarantine_key
    WHERE id = duplicate_row.id;
  END LOOP;
END $$;

DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM "PortfolioQualityIssue"
    GROUP BY "issueKey"
    HAVING count(*) > 1
  ) THEN
    RAISE EXCEPTION 'PortfolioQualityIssue integrity repair left duplicate issue keys';
  END IF;
END $$;

DROP INDEX IF EXISTS "PortfolioQualityIssue_issueKey_key";
CREATE UNIQUE INDEX "PortfolioQualityIssue_issueKey_key"
  ON "PortfolioQualityIssue" ("issueKey");

COMMIT;
