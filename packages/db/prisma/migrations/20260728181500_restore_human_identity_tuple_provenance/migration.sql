-- Restore a coherent human-confirmed identity tuple from the authoritative
-- resolution ledger. The earlier repair repoints every resolution log to the
-- canonical survivor and keeps each merged entity as a tombstone. The ledger
-- therefore preserves decision time and protects a human correction written
-- after a partial upgrade. Legacy human tuples without a ledger row use a
-- documented tombstone fallback; discovery lastSeenAt is only a fallback
-- ordering signal, never the primary decision clock.

SET lock_timeout = '30s';
LOCK TABLE "InventoryEntity" IN SHARE ROW EXCLUSIVE MODE;

WITH logged_human_choice AS (
  SELECT DISTINCT ON (resolution."inventoryEntityId")
    resolution."inventoryEntityId" AS survivor_id,
    resolution."catalogIdentityId" AS catalog_identity_id,
    resolution."resolutionType" AS identity_status,
    resolution.confidence AS identity_confidence
  FROM "IdentityResolutionLog" resolution
  JOIN "InventoryEntity" survivor
    ON survivor.id = resolution."inventoryEntityId"
   AND survivor."mergedIntoId" IS NULL
  WHERE resolution."inventoryEntityId" IS NOT NULL
    AND resolution."catalogIdentityId" IS NOT NULL
    AND resolution."resolutionType" IN ('human_confirmed', 'human_corrected')
    AND EXISTS (
      SELECT 1
      FROM "InventoryEntity" source
      WHERE source."mergedIntoId" = survivor.id
    )
  ORDER BY
    resolution."inventoryEntityId",
    resolution."createdAt" DESC,
    (resolution."resolutionType" = 'human_corrected') DESC,
    resolution.id DESC
),
legacy_human_choice AS (
  SELECT DISTINCT ON (source."mergedIntoId")
    source."mergedIntoId" AS survivor_id,
    source."catalogIdentityId" AS catalog_identity_id,
    source."identityStatus" AS identity_status,
    source."identityConfidence" AS identity_confidence
  FROM "InventoryEntity" source
  WHERE source."mergedIntoId" IS NOT NULL
    AND source."catalogIdentityId" IS NOT NULL
    AND source."identityStatus" IN ('human_confirmed', 'human_corrected')
    AND NOT EXISTS (
      SELECT 1
      FROM logged_human_choice logged
      WHERE logged.survivor_id = source."mergedIntoId"
    )
  ORDER BY
    source."mergedIntoId",
    (source."identityStatus" = 'human_corrected') DESC,
    source."lastSeenAt" DESC,
    source.id DESC
),
human_identity_choice AS (
  SELECT * FROM logged_human_choice
  UNION ALL
  SELECT * FROM legacy_human_choice
)
UPDATE "InventoryEntity" survivor
SET
  "catalogIdentityId" = choice.catalog_identity_id,
  "identityStatus" = choice.identity_status,
  "identityConfidence" = choice.identity_confidence
FROM human_identity_choice choice
WHERE survivor.id = choice.survivor_id
  AND survivor."mergedIntoId" IS NULL
  AND (
    survivor."catalogIdentityId",
    survivor."identityStatus",
    survivor."identityConfidence"
  ) IS DISTINCT FROM (
    choice.catalog_identity_id,
    choice.identity_status,
    choice.identity_confidence
  );
