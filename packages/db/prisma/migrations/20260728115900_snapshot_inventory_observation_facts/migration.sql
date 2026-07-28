-- Snapshot mutable observation facts before the fleet repair selects the
-- oldest row as the stable canonical identity. The repair's ordered JSON
-- rollup carries the newest snapshot onto the survivor, while each retained
-- tombstone keeps its own original values for recovery and audit.

SET lock_timeout = '30s';
LOCK TABLE "InventoryEntity" IN SHARE ROW EXCLUSIVE MODE;

UPDATE "InventoryEntity"
SET properties = properties || jsonb_build_object(
  '_dpfObservationSnapshot',
  jsonb_build_object(
    'version', 1,
    'name', name,
    'status', status,
    'providerView', "providerView",
    'discoveredViaConnectionId', "discoveredViaConnectionId"
  )
)
WHERE NOT properties ? '_dpfObservationSnapshot';
