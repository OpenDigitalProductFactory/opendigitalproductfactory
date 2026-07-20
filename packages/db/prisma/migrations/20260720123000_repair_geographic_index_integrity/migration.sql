-- BI-7C2B91EF — repair geographic heap/index divergence without deleting
-- reference-data rows. Affected installs can contain duplicate Region/City
-- keys even while pg_index reports the old unique btrees as valid. Equality
-- lookups can therefore miss heap rows and the Contributor sanitized clone
-- fails when it copies those rows into a freshly indexed destination.
--
-- Fleet safety: remove only the untrustworthy uniqueness indexes, derive
-- deterministic survivor maps from heap scans, repoint every dependent FK,
-- retain losers as uniquely labelled superseded tombstones, then recreate and
-- rebuild the indexes. Clean installs produce empty maps and no row changes.
-- The transaction fails closed if any duplicate remains before index creation.

BEGIN;

-- Do not let a corrupt lookup btree participate in survivor discovery.
SET LOCAL enable_indexscan = off;
SET LOCAL enable_bitmapscan = off;

DROP INDEX IF EXISTS "Region_countryId_name_ci";
DROP INDEX IF EXISTS "City_regionId_name_ci";
DROP INDEX IF EXISTS "City_regionId_nameNormalized_unique_pending";
DROP INDEX IF EXISTS "City_regionId_nameNormalized_disambiguator_unique";

CREATE TEMP TABLE _dpf_region_duplicate_map (
  loser_id TEXT PRIMARY KEY,
  survivor_id TEXT NOT NULL
) ON COMMIT DROP;

INSERT INTO _dpf_region_duplicate_map (loser_id, survivor_id)
WITH ranked AS (
  SELECT
    r.id,
    first_value(r.id) OVER (
      PARTITION BY lower(r.name), r."countryId"
      ORDER BY (r.status = 'active') DESC, r."createdAt", r.id
    ) AS survivor_id
  FROM "Region" r
)
SELECT id, survivor_id
FROM ranked
WHERE id <> survivor_id;

CREATE TEMP TABLE _dpf_city_duplicate_map (
  loser_id TEXT PRIMARY KEY,
  survivor_id TEXT NOT NULL,
  target_region_id TEXT NOT NULL
) ON COMMIT DROP;

INSERT INTO _dpf_city_duplicate_map (loser_id, survivor_id, target_region_id)
WITH targeted AS (
  SELECT
    c.*,
    coalesce(rm.survivor_id, c."regionId") AS target_region_id,
    (SELECT count(*) FROM "Address" a WHERE a."cityId" = c.id) AS address_refs
  FROM "City" c
  LEFT JOIN _dpf_region_duplicate_map rm ON rm.loser_id = c."regionId"
), ranked AS (
  SELECT
    t.*,
    first_value(t.id) OVER (
      PARTITION BY lower(t.name), t.target_region_id
      ORDER BY
        (t.status = 'active') DESC,
        t.address_refs DESC,
        (t."regionId" = t.target_region_id) DESC,
        t."createdAt",
        t.id
    ) AS survivor_id
  FROM targeted t
)
SELECT id, survivor_id, target_region_id
FROM ranked
WHERE id <> survivor_id;

-- Preserve every external City reference on the selected survivor.
UPDATE "Address" a
SET "cityId" = m.survivor_id,
    "updatedAt" = now()
FROM _dpf_city_duplicate_map m
WHERE a."cityId" = m.loser_id;

-- Collapse pre-existing lineage that points at a newly superseded City.
UPDATE "City" c
SET "mergedIntoId" = m.survivor_id,
    "updatedAt" = now()
FROM _dpf_city_duplicate_map m
WHERE c."mergedIntoId" = m.loser_id;

-- Retain duplicate City rows as auditable tombstones. The id suffix restores
-- case-insensitive raw-name uniqueness; the disambiguator also removes the
-- row from the pending normalized-name uniqueness population.
UPDATE "City" c
SET
  status = 'superseded',
  "mergedIntoId" = m.survivor_id,
  name = c.name || ' [superseded ' || c.id || ']',
  "nameNormalized" = c."nameNormalized" || ' [superseded ' || c.id || ']',
  disambiguator = 'superseded:' || c.id,
  "updatedAt" = now()
FROM _dpf_city_duplicate_map m
WHERE c.id = m.loser_id;

-- Move each non-duplicate surviving City out of a duplicate Region. City
-- tombstones stay with their Region tombstone so historical lineage remains
-- intelligible; active/surviving rows converge on the canonical Region.
UPDATE "City" c
SET "regionId" = rm.survivor_id,
    "updatedAt" = now()
FROM _dpf_region_duplicate_map rm
WHERE c."regionId" = rm.loser_id
  AND NOT EXISTS (
    SELECT 1 FROM _dpf_city_duplicate_map cm WHERE cm.loser_id = c.id
  );

-- Different raw spellings can intentionally normalize to the same locality
-- (for example Cafe/Café). Preserve them and make the later rows explicit
-- disambiguated variants instead of merging distinct labels.
WITH normalized_ranked AS (
  SELECT
    c.id,
    row_number() OVER (
      PARTITION BY c."regionId", c."nameNormalized"
      ORDER BY
        (c.status = 'active') DESC,
        (SELECT count(*) FROM "Address" a WHERE a."cityId" = c.id) DESC,
        c."createdAt",
        c.id
    ) AS duplicate_rank
  FROM "City" c
  WHERE c.disambiguator IS NULL
)
UPDATE "City" c
SET disambiguator = 'integrity-repair:' || c.id,
    "updatedAt" = now()
FROM normalized_ranked r
WHERE c.id = r.id
  AND r.duplicate_rank > 1;

-- A corrupt disambiguated-name index can likewise admit duplicate explicit
-- labels. Preserve the first and assign deterministic repair labels to later
-- rows so the rebuilt index can enforce the contract again.
WITH disambiguated_ranked AS (
  SELECT
    c.id,
    row_number() OVER (
      PARTITION BY c."regionId", c."nameNormalized", c.disambiguator
      ORDER BY
        (c.status = 'active') DESC,
        (SELECT count(*) FROM "Address" a WHERE a."cityId" = c.id) DESC,
        c."createdAt",
        c.id
    ) AS duplicate_rank
  FROM "City" c
  WHERE c.disambiguator IS NOT NULL
)
UPDATE "City" c
SET disambiguator = 'integrity-repair:' || c.id,
    "updatedAt" = now()
FROM disambiguated_ranked r
WHERE c.id = r.id
  AND r.duplicate_rank > 1;

-- Collapse pre-existing lineage that points at a newly superseded Region.
UPDATE "Region" r
SET "mergedIntoId" = m.survivor_id,
    "updatedAt" = now()
FROM _dpf_region_duplicate_map m
WHERE r."mergedIntoId" = m.loser_id;

-- Keep Region losers as uniquely labelled tombstones; no Region or City row is
-- deleted by this repair.
UPDATE "Region" r
SET
  status = 'superseded',
  "mergedIntoId" = m.survivor_id,
  name = r.name || ' [superseded ' || r.id || ']',
  "updatedAt" = now()
FROM _dpf_region_duplicate_map m
WHERE r.id = m.loser_id;

-- Heap-grounded assertions run while the suspect indexes are absent.
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM "Region" GROUP BY lower(name), "countryId" HAVING count(*) > 1
  ) THEN
    RAISE EXCEPTION 'geographic integrity repair left duplicate Region keys';
  END IF;
  IF EXISTS (
    SELECT 1 FROM "City" GROUP BY lower(name), "regionId" HAVING count(*) > 1
  ) THEN
    RAISE EXCEPTION 'geographic integrity repair left duplicate City keys';
  END IF;
  IF EXISTS (
    SELECT 1
    FROM "City"
    WHERE disambiguator IS NULL
    GROUP BY "regionId", "nameNormalized"
    HAVING count(*) > 1
  ) THEN
    RAISE EXCEPTION 'geographic integrity repair left pending normalized City duplicates';
  END IF;
  IF EXISTS (
    SELECT 1
    FROM "City"
    WHERE disambiguator IS NOT NULL
    GROUP BY "regionId", "nameNormalized", disambiguator
    HAVING count(*) > 1
  ) THEN
    RAISE EXCEPTION 'geographic integrity repair left disambiguated City duplicates';
  END IF;
END $$;

CREATE UNIQUE INDEX "Region_countryId_name_ci"
  ON "Region" (lower(name), "countryId");
CREATE UNIQUE INDEX "City_regionId_name_ci"
  ON "City" (lower(name), "regionId");
CREATE UNIQUE INDEX "City_regionId_nameNormalized_unique_pending"
  ON "City" ("regionId", "nameNormalized")
  WHERE disambiguator IS NULL;
CREATE UNIQUE INDEX "City_regionId_nameNormalized_disambiguator_unique"
  ON "City" ("regionId", "nameNormalized", disambiguator)
  WHERE disambiguator IS NOT NULL;

-- Rebuild every other lookup index on the affected small reference tables too;
-- a valid-looking non-unique btree can hide heap rows just as the unique ones
-- did. Non-CONCURRENT REINDEX is transaction-safe for Prisma migrate deploy.
REINDEX TABLE "Region";
REINDEX TABLE "City";

COMMIT;
