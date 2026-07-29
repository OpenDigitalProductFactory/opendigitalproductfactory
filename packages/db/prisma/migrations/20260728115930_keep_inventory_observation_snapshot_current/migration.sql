-- Keep the pre-repair observation snapshot current if the repair migration
-- fails and the old runtime resumes writes before a later upgrade retry.
-- The trigger deliberately ignores the repair's superseded tombstone update.

CREATE OR REPLACE FUNCTION _dpf_refresh_inventory_observation_snapshot()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    NEW.properties = coalesce(NEW.properties, '{}'::jsonb) || jsonb_build_object(
      '_dpfObservationSnapshot',
      jsonb_build_object(
        'version', 1,
        'name', NEW.name,
        'status', NEW.status,
        'providerView', NEW."providerView",
        'discoveredViaConnectionId', NEW."discoveredViaConnectionId"
      )
    );
    RETURN NEW;
  END IF;

  IF NEW.status <> 'superseded'
    AND (
      NOT coalesce(NEW.properties, '{}'::jsonb) ? '_dpfObservationSnapshot'
      OR NEW.name IS DISTINCT FROM OLD.name
      OR NEW.status IS DISTINCT FROM OLD.status
      OR NEW."providerView" IS DISTINCT FROM OLD."providerView"
      OR NEW."discoveredViaConnectionId"
        IS DISTINCT FROM OLD."discoveredViaConnectionId"
    )
  THEN
    NEW.properties = coalesce(NEW.properties, '{}'::jsonb) || jsonb_build_object(
      '_dpfObservationSnapshot',
      jsonb_build_object(
        'version', 1,
        'name', NEW.name,
        'status', NEW.status,
        'providerView', NEW."providerView",
        'discoveredViaConnectionId', NEW."discoveredViaConnectionId"
      )
    );
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS _dpf_keep_inventory_observation_snapshot_current
  ON "InventoryEntity";

CREATE TRIGGER _dpf_keep_inventory_observation_snapshot_current
BEFORE INSERT OR UPDATE ON "InventoryEntity"
FOR EACH ROW
EXECUTE FUNCTION _dpf_refresh_inventory_observation_snapshot();
