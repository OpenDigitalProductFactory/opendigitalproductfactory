-- BI-8C121D30: collapse duplicate EaRelationship rows and enforce one edge per (from, to, type).
-- Projection/import extractors created relationships without upserting, so duplicates accumulated.
-- Ordering matters: clean the data BEFORE adding the unique index, or the CREATE fails.

-- 1) Remove self-loops (an element related to itself). Live data: 44 rows, all `associated_with`
--    projection noise; never meaningful on the live views and dropped by the canvas anyway.
DELETE FROM "EaRelationship" WHERE "fromElementId" = "toElementId";

-- 2) Collapse duplicate (from, to, type) groups, keeping the OLDEST row (smallest createdAt, then id).
DELETE FROM "EaRelationship" a
USING "EaRelationship" b
WHERE a."fromElementId" = b."fromElementId"
  AND a."toElementId" = b."toElementId"
  AND a."relationshipTypeId" = b."relationshipTypeId"
  AND (a."createdAt" > b."createdAt"
       OR (a."createdAt" = b."createdAt" AND a."id" > b."id"));

-- 3) Enforce uniqueness so extractors/imports can no longer accumulate duplicates.
CREATE UNIQUE INDEX "EaRelationship_triple_key"
  ON "EaRelationship" ("fromElementId", "toElementId", "relationshipTypeId");
