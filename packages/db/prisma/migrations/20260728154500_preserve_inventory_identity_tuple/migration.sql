-- Preserve catalog identity, status, and confidence as one observed tuple.
-- The preceding fleet repair retains every merged InventoryEntity as a
-- tombstone, so this forward correction can recover the authoritative tuple
-- without editing the checksum-immutable repair migration.

SET lock_timeout = '30s';
LOCK TABLE "InventoryEntity" IN SHARE ROW EXCLUSIVE MODE;

WITH identity_choice AS (
  SELECT DISTINCT ON (coalesce(entity."mergedIntoId", entity.id))
    coalesce(entity."mergedIntoId", entity.id) AS survivor_id,
    entity."catalogIdentityId" AS catalog_identity_id,
    entity."identityStatus" AS identity_status,
    entity."identityConfidence" AS identity_confidence
  FROM "InventoryEntity" entity
  WHERE entity."catalogIdentityId" IS NOT NULL
  ORDER BY
    coalesce(entity."mergedIntoId", entity.id),
    (entity."identityStatus" IN ('human_confirmed', 'human_corrected')) DESC,
    entity."lastSeenAt" DESC,
    entity.id DESC
)
UPDATE "InventoryEntity" survivor
SET
  "catalogIdentityId" = choice.catalog_identity_id,
  "identityStatus" = choice.identity_status,
  "identityConfidence" = choice.identity_confidence
FROM identity_choice choice
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
