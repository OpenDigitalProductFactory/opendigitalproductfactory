-- BI-A794805F — restore agreement between the EaReferenceModelElement heap
-- and its canonical unique (modelId, slug) index. Affected installs can hold
-- duplicate heap rows even while pg_index reports the btree healthy.
--
-- Fleet safety: duplicate rows are quarantined by slug, never deleted. Element
-- ids and every ID-based parent/assessment relationship remain unchanged.
-- Clean installs change no data; the migration is idempotent and fails closed
-- if duplicate natural keys remain.

BEGIN;

SET LOCAL enable_indexscan = off;
SET LOCAL enable_indexonlyscan = off;
SET LOCAL enable_bitmapscan = off;

-- The table has no creation timestamp, so lexical id order is the stable,
-- repeatable survivor rule. The collision loop is scoped to the model because
-- the canonical key is the (modelId, slug) pair.
DO $$
DECLARE
  duplicate_row RECORD;
  quarantine_slug TEXT;
BEGIN
  FOR duplicate_row IN
    WITH ranked AS MATERIALIZED (
      SELECT
        id,
        "modelId",
        slug,
        row_number() OVER (
          PARTITION BY "modelId", slug
          ORDER BY id
        ) AS duplicate_rank
      FROM "EaReferenceModelElement"
    )
    SELECT id, "modelId", slug
    FROM ranked
    WHERE duplicate_rank > 1
    ORDER BY "modelId", slug, id
  LOOP
    quarantine_slug := '__dpf_quarantined__' || duplicate_row.id || '__' || duplicate_row.slug;
    WHILE EXISTS (
      SELECT 1
      FROM "EaReferenceModelElement"
      WHERE "modelId" = duplicate_row."modelId"
        AND slug = quarantine_slug
        AND id <> duplicate_row.id
    ) LOOP
      quarantine_slug := quarantine_slug || '_';
    END LOOP;

    UPDATE "EaReferenceModelElement"
    SET slug = quarantine_slug
    WHERE id = duplicate_row.id;
  END LOOP;
END $$;

-- This assertion is heap-grounded because every index scan class is disabled.
DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM "EaReferenceModelElement"
    GROUP BY "modelId", slug
    HAVING count(*) > 1
  ) THEN
    RAISE EXCEPTION 'EaReferenceModelElement integrity repair left duplicate (modelId, slug) keys';
  END IF;
END $$;

DROP INDEX IF EXISTS "EaReferenceModelElement_modelId_slug_key";
CREATE UNIQUE INDEX "EaReferenceModelElement_modelId_slug_key"
  ON "EaReferenceModelElement" ("modelId", slug);

COMMIT;
