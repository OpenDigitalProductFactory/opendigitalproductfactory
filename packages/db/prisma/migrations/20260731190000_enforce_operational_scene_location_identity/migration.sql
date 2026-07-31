-- Preserve every authored layout before enforcing one scene per organization,
-- twin template, and non-null location. Older/manual duplicate rows are detached
-- to a stable recovery location instead of deleted; the most recently updated
-- row remains the active location layout.
WITH "ranked_layouts" AS (
  SELECT
    "id",
    row_number() OVER (
      PARTITION BY "orgId", "twinTemplate", "locationId"
      ORDER BY "updatedAt" DESC, "id" ASC
    ) AS "duplicate_rank"
  FROM "OperationalSceneLayout"
  WHERE "locationId" IS NOT NULL
)
UPDATE "OperationalSceneLayout" AS "layout"
SET "locationId" =
  "layout"."locationId" || ':duplicate:' || "layout"."id"
FROM "ranked_layouts"
WHERE "layout"."id" = "ranked_layouts"."id"
  AND "ranked_layouts"."duplicate_rank" > 1;

CREATE UNIQUE INDEX
  "OperationalSceneLayout_orgId_twinTemplate_locationId_key"
ON "OperationalSceneLayout"("orgId", "twinTemplate", "locationId");
