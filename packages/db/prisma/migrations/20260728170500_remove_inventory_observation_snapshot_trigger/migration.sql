-- The repair and forward restorations have converged. Remove the temporary
-- retry bridge, clear snapshots from canonical rows, and retain each
-- superseded row's original snapshot as recovery evidence.

DROP TRIGGER IF EXISTS _dpf_keep_inventory_observation_snapshot_current
  ON "InventoryEntity";

DROP FUNCTION IF EXISTS _dpf_refresh_inventory_observation_snapshot();

UPDATE "InventoryEntity"
SET properties = properties - '_dpfObservationSnapshot'
WHERE "mergedIntoId" IS NULL
  AND properties ? '_dpfObservationSnapshot';
