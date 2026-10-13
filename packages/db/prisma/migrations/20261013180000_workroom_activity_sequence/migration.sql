-- BI-62514632 (EP-07B49BD8): the Workroom activity trail becomes the room's
-- ordered log. Every new WorkCapsuleActivity row gets the next per-room
-- sequence number, assigned by a trigger that advances the room's counter
-- (an UPDATE on the room row, so concurrent writers to one room queue on its
-- row lock and numbers never repeat or reorder). A reader that has seen up to
-- N reads rows with sequence > N, so nothing committed is skipped and a
-- crash between commit and the live wake-up loses nothing. Design:
-- docs/superpowers/specs/2026-10-07-durable-delegation-ledger-design.md §4.4.
--
-- Additive: one counter column (default 0), one nullable column, a unique
-- index and a trigger. Existing rows keep NULL; the trigger fires on inserts
-- only. Covers every writer, including direct prisma.workroomActivity.create
-- calls, without changing them. Safe against any data state and re-runnable.
ALTER TABLE "WorkCapsule" ADD COLUMN IF NOT EXISTS "activitySequence" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "WorkCapsuleActivity" ADD COLUMN IF NOT EXISTS "sequence" INTEGER;

-- @migration-safety: data-safe: "sequence" is added by this migration, so every existing row holds NULL, and Postgres unique indexes never treat NULLs as equal; no existing row can violate the index.
CREATE UNIQUE INDEX IF NOT EXISTS "WorkCapsuleActivity_workCapsuleId_sequence_key"
  ON "WorkCapsuleActivity"("workCapsuleId", "sequence");

CREATE OR REPLACE FUNCTION "workcapsule_activity_assign_sequence"() RETURNS trigger AS $$
BEGIN
  IF NEW."sequence" IS NULL THEN
    UPDATE "WorkCapsule"
       SET "activitySequence" = "activitySequence" + 1
     WHERE "id" = NEW."workCapsuleId"
     RETURNING "activitySequence" INTO NEW."sequence";
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS "workcapsule_activity_assign_sequence" ON "WorkCapsuleActivity";
CREATE TRIGGER "workcapsule_activity_assign_sequence"
  BEFORE INSERT ON "WorkCapsuleActivity"
  FOR EACH ROW EXECUTE FUNCTION "workcapsule_activity_assign_sequence"();
