-- BI-FB6381E6 — restore agreement between the EaReferenceModelArtifact heap
-- and its canonical unique (modelId, path) index. Affected installs can hold
-- duplicate heap rows even while pg_index reports the btree healthy.
--
-- Fleet safety: duplicate rows are quarantined by path, never deleted. The
-- artifact id and every ID-based proposal relationship remain unchanged.
-- Clean installs change no data; the migration is idempotent and fails closed
-- if duplicate natural keys remain.

BEGIN;

SET LOCAL enable_indexscan = off;
SET LOCAL enable_indexonlyscan = off;
SET LOCAL enable_bitmapscan = off;

-- Pick the oldest row as the stable canonical artifact. Quarantine paths
-- include the loser id and original path; the collision loop is scoped to the
-- model because the canonical key is the (modelId, path) pair.
DO $$
DECLARE
  duplicate_row RECORD;
  quarantine_path TEXT;
BEGIN
  FOR duplicate_row IN
    WITH ranked AS MATERIALIZED (
      SELECT
        id,
        "modelId",
        path,
        row_number() OVER (
          PARTITION BY "modelId", path
          ORDER BY "createdAt", id
        ) AS duplicate_rank
      FROM "EaReferenceModelArtifact"
    )
    SELECT id, "modelId", path
    FROM ranked
    WHERE duplicate_rank > 1
    ORDER BY "modelId", path, id
  LOOP
    quarantine_path := '__dpf_quarantined__' || duplicate_row.id || '__' || duplicate_row.path;
    WHILE EXISTS (
      SELECT 1
      FROM "EaReferenceModelArtifact"
      WHERE "modelId" = duplicate_row."modelId"
        AND path = quarantine_path
        AND id <> duplicate_row.id
    ) LOOP
      quarantine_path := quarantine_path || '_';
    END LOOP;

    UPDATE "EaReferenceModelArtifact"
    SET path = quarantine_path
    WHERE id = duplicate_row.id;
  END LOOP;
END $$;

-- This assertion is heap-grounded because every index scan class is disabled.
DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM "EaReferenceModelArtifact"
    GROUP BY "modelId", path
    HAVING count(*) > 1
  ) THEN
    RAISE EXCEPTION 'EaReferenceModelArtifact integrity repair left duplicate (modelId, path) keys';
  END IF;
END $$;

DROP INDEX IF EXISTS "EaReferenceModelArtifact_modelId_path_key";
CREATE UNIQUE INDEX "EaReferenceModelArtifact_modelId_path_key"
  ON "EaReferenceModelArtifact" ("modelId", path);

COMMIT;
