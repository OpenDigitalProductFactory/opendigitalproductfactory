-- BI-BF20F828: prepare retained activity for the unchanged ingestion hardening.
-- The published hardening migration cannot assign a protected work-intent row
-- through the original append-only guard. This exception exists only inside
-- this locked transaction and is removed before any change becomes visible.
BEGIN;
SET LOCAL lock_timeout = '5s';
LOCK TABLE "WorkCapsule" IN ACCESS EXCLUSIVE MODE;
LOCK TABLE "WorkCapsuleActivity" IN ACCESS EXCLUSIVE MODE;

DO $prepare$
BEGIN
  -- Installs that already completed hardening have immutable positions. Do not
  -- touch either their retained data or their functions on an out-of-order deploy.
  IF EXISTS (
    SELECT 1 FROM pg_trigger
    WHERE tgrelid = '"WorkCapsuleActivity"'::regclass
      AND tgname = 'WorkCapsuleActivity_preserve_sequence' AND NOT tgisinternal
  ) THEN
    RETURN;
  END IF;

  -- Never overwrite an independently changed guard with a historical body.
  -- Compare the source and its OLD-row attachment before creating an exception.
  IF (SELECT prosrc FROM pg_proc WHERE oid =
        to_regprocedure('refuse_initiative_governance_activity_mutation()'))
       IS DISTINCT FROM $original_guard$
BEGIN
  RAISE EXCEPTION 'initiative governance activities are append-only';
END;
$original_guard$
     OR (SELECT prosrc FROM pg_proc WHERE oid =
        to_regprocedure('workcapsule_activity_assign_sequence()'))
       IS DISTINCT FROM $original_assignment$
BEGIN
  IF NEW."sequence" IS NULL THEN
    UPDATE "WorkCapsule"
       SET "activitySequence" = "activitySequence" + 1
     WHERE "id" = NEW."workCapsuleId"
     RETURNING "activitySequence" INTO NEW."sequence";
  END IF;
  RETURN NEW;
END;
$original_assignment$
     OR EXISTS (
       SELECT 1 FROM pg_proc
       WHERE oid IN (
         to_regprocedure('refuse_initiative_governance_activity_mutation()'),
         to_regprocedure('workcapsule_activity_assign_sequence()')
       ) AND (prosecdef OR proisstrict OR proleakproof OR proconfig IS NOT NULL
         OR provolatile <> 'v' OR proparallel <> 'u' OR prokind <> 'f'
         OR prorettype <> 'trigger'::regtype
         OR prolang <> (SELECT oid FROM pg_language WHERE lanname = 'plpgsql'))
     )
     OR NOT EXISTS (
       SELECT 1 FROM pg_trigger
       WHERE tgrelid = '"WorkCapsuleActivity"'::regclass
         AND tgname = 'initiative_work_intent_immutable'
         AND tgenabled = 'O' AND tgtype = 27 AND tgnargs = 0
         AND tgfoid = to_regprocedure('refuse_initiative_governance_activity_mutation()')
         AND regexp_replace(substring(pg_get_triggerdef(oid) FROM 'WHEN \((.*)\) EXECUTE FUNCTION'),
           '[[:space:]()]', '', 'g') = 'old.kind=''work-intent-declared''::text'
     )
     OR NOT EXISTS (
       SELECT 1 FROM pg_trigger
       WHERE tgrelid = '"WorkCapsuleActivity"'::regclass
         AND tgname = 'workcapsule_activity_assign_sequence'
         AND tgenabled = 'O' AND tgtype = 7 AND tgnargs = 0 AND tgqual IS NULL
         AND tgfoid = to_regprocedure('workcapsule_activity_assign_sequence()')
     ) THEN
    RAISE EXCEPTION 'Workroom ingestion preparation requires the original append-only and sequence guards'
      USING ERRCODE = '23514';
  END IF;

  CREATE OR REPLACE FUNCTION refuse_initiative_governance_activity_mutation()
  RETURNS TRIGGER AS $guard$
BEGIN
  IF TG_OP = 'UPDATE' AND TG_RELID = '"WorkCapsuleActivity"'::regclass THEN
    IF OLD."kind" = 'work-intent-declared'
       AND OLD."sequence" IS NULL AND NEW."sequence" IS NOT NULL
       AND NEW."sequence" > 0
       AND (to_jsonb(NEW) - 'sequence') = (to_jsonb(OLD) - 'sequence') THEN
      RETURN NEW;
    END IF;
  END IF;
  RAISE EXCEPTION 'initiative governance activities are append-only';
END;
$guard$ LANGUAGE plpgsql;

  UPDATE "WorkCapsule" SET "activitySequence" = 0 WHERE "activitySequence" < 0;
  UPDATE "WorkCapsule" AS room
  SET "activitySequence" = GREATEST(room."activitySequence", retained.high, 0)
  FROM (
    SELECT "workCapsuleId", max("sequence") AS high
    FROM "WorkCapsuleActivity" GROUP BY "workCapsuleId"
  ) AS retained WHERE retained."workCapsuleId" = room.id;

  -- Assign the entire room's NULL population or none of it. Existing positions
  -- and semantic fields stay intact; timestamp order is not historical arrival.
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

  UPDATE "WorkCapsule" AS room
  SET "activitySequence" = GREATEST(room."activitySequence", retained.high, 0)
  FROM (
    SELECT "workCapsuleId", max("sequence") AS high
    FROM "WorkCapsuleActivity" GROUP BY "workCapsuleId"
  ) AS retained WHERE retained."workCapsuleId" = room.id;

  -- Exact original refusal body: no disabled trigger or metadata exception is
  -- committed, including when the following migration fails for another reason.
  CREATE OR REPLACE FUNCTION refuse_initiative_governance_activity_mutation()
RETURNS TRIGGER AS $$
BEGIN
  RAISE EXCEPTION 'initiative governance activities are append-only';
END;
$$ LANGUAGE plpgsql;
END;
$prepare$;
COMMIT;
