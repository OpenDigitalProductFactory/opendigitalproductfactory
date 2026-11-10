-- BI-BF20F828 / DI-7588F40259CF: extend BI-62514632's canonical sequence.
-- No second counter, column, ordering ledger or public cursor type is added.
-- Preserve every existing sequence. Legacy NULL rows become newly ingested
-- retained evidence AFTER the committed prefix, not reconstructed chronology.
BEGIN;
SET LOCAL lock_timeout = '5s';
LOCK TABLE "WorkCapsule" IN ACCESS EXCLUSIVE MODE;
LOCK TABLE "WorkCapsuleActivity" IN ACCESS EXCLUSIVE MODE;

UPDATE "WorkCapsule" SET "activitySequence" = 0 WHERE "activitySequence" < 0;

-- Earlier explicit-position writers could have exceeded the trigger counter.
-- Reconcile upward only. Existing integer positions remain byte-for-byte intact.
UPDATE "WorkCapsule" AS room
SET "activitySequence" = GREATEST(room."activitySequence", retained.high, 0)
FROM (
  SELECT "workCapsuleId", max("sequence") AS high
  FROM "WorkCapsuleActivity" GROUP BY "workCapsuleId"
) AS retained WHERE retained."workCapsuleId" = room.id;

WITH eligible AS (
  SELECT room.id, room."activitySequence" AS base
  FROM "WorkCapsule" room JOIN "WorkCapsuleActivity" activity
    ON activity."workCapsuleId" = room.id AND activity."sequence" IS NULL
  GROUP BY room.id
  HAVING room."activitySequence"::bigint + count(*) <= 2147483647
), retained AS (
  SELECT activity.id, eligible.base::bigint + row_number() OVER (
    PARTITION BY activity."workCapsuleId" ORDER BY activity."recordedAt", activity.id
  ) AS position
  FROM "WorkCapsuleActivity" activity JOIN eligible ON eligible.id = activity."workCapsuleId"
  WHERE activity."sequence" IS NULL
)
UPDATE "WorkCapsuleActivity" AS activity
SET "sequence" = retained.position::integer
FROM retained WHERE retained.id = activity.id;

-- Overflow rooms retain their original NULL evidence, explicitly unsequenced.
-- Readers continue to label coverage retention-unverified; never shorten history
-- or renumber existing positions to make a migration pass.
UPDATE "WorkCapsule" AS room
SET "activitySequence" = GREATEST(room."activitySequence", retained.high, 0)
FROM (
  SELECT "workCapsuleId", max("sequence") AS high
  FROM "WorkCapsuleActivity" GROUP BY "workCapsuleId"
) AS retained WHERE retained."workCapsuleId" = room.id;

CREATE OR REPLACE FUNCTION "workcapsule_activity_assign_sequence"() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF NEW."sequence" IS NOT NULL THEN
    RAISE EXCEPTION 'Workroom ingestion positions are database-owned'
      USING ERRCODE = '23514';
  END IF;
  UPDATE "WorkCapsule"
  SET "activitySequence" = "activitySequence" + 1
  WHERE id = NEW."workCapsuleId"
  RETURNING "activitySequence" INTO NEW."sequence";
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Workroom activity parent is missing'
      USING ERRCODE = '23503';
  END IF;
  -- Duplicate skips may allocate gaps. Caller rollback includes allocation.
  RETURN NEW;
END;
$$;

CREATE FUNCTION preserve_workroom_activity_sequence() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF NEW."sequence" IS DISTINCT FROM OLD."sequence"
     OR NEW."workCapsuleId" IS DISTINCT FROM OLD."workCapsuleId" THEN
    RAISE EXCEPTION 'Workroom ingestion identity is immutable'
      USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER "WorkCapsuleActivity_preserve_sequence"
  BEFORE UPDATE OF "sequence", "workCapsuleId" ON "WorkCapsuleActivity"
  FOR EACH ROW EXECUTE FUNCTION preserve_workroom_activity_sequence();
COMMIT;
