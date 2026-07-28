-- Restore the newest coherent mutable observation facts selected by the
-- preceding repair's ordered property rollup. Canonical rows shed the
-- temporary snapshot; retained tombstones keep theirs for recoverability.

SET lock_timeout = '30s';
LOCK TABLE "InventoryEntity" IN SHARE ROW EXCLUSIVE MODE;

WITH observation_choice AS (
  SELECT
    entity.id,
    entity.properties -> '_dpfObservationSnapshot' AS snapshot
  FROM "InventoryEntity" entity
  WHERE entity."mergedIntoId" IS NULL
    AND entity.properties ? '_dpfObservationSnapshot'
)
UPDATE "InventoryEntity" survivor
SET
  name = coalesce(choice.snapshot ->> 'name', survivor.name),
  status = coalesce(choice.snapshot ->> 'status', survivor.status),
  "providerView" =
    coalesce(choice.snapshot ->> 'providerView', survivor."providerView"),
  "discoveredViaConnectionId" =
    choice.snapshot ->> 'discoveredViaConnectionId',
  properties = survivor.properties - '_dpfObservationSnapshot'
FROM observation_choice choice
WHERE survivor.id = choice.id;
