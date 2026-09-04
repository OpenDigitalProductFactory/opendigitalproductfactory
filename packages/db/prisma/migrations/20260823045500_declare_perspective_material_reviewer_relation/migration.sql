-- @migration-safety: data-safe: ADD CONSTRAINT cannot fail here because every
-- "reviewedByUserId" is NULL when this runs, on every install. The column was
-- created by 20260823041254 (immediately prior, same release) with no backfill,
-- and its only writer — approveHeldProfessionMaterial, reached from the
-- /coworker-decisions/review approval surface — ships in this same release and
-- cannot have executed before deploy. An FK also never checks NULLs, so there
-- is no orphan population to validate and no need for NOT VALID, which would
-- otherwise leave a permanently unvalidated constraint for someone to remember.

-- Declares the relation behind PerspectiveMaterial.reviewedByUserId
-- (BI-5F3BFD13). The preceding migration added the column; an FK-shaped column
-- with no constraint is exactly the drift the data-architect ratchet exists to
-- stop, so the constraint lands here rather than by editing that migration —
-- an applied migration is immutable, and correcting one means a NEW migration.
--
-- Safe against any existing data state: every reviewedByUserId is NULL until an
-- operator approves held material through the review surface, so there are no
-- orphan rows to validate and the constraint can be added directly.
--
-- SetNull rather than Cascade: deleting a user must never delete the doctrine
-- they approved. The approval record survives with an unattributed reviewer.
CREATE INDEX IF NOT EXISTS "PerspectiveMaterial_reviewedByUserId_idx"
  ON "PerspectiveMaterial" ("reviewedByUserId");

ALTER TABLE "PerspectiveMaterial"
  DROP CONSTRAINT IF EXISTS "PerspectiveMaterial_reviewedByUserId_fkey";
ALTER TABLE "PerspectiveMaterial"
  ADD CONSTRAINT "PerspectiveMaterial_reviewedByUserId_fkey"
  FOREIGN KEY ("reviewedByUserId") REFERENCES "User"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;
