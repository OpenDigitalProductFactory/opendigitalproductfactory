-- BI-858FDE5A: an account handover (BI-F25A5FC7) re-homed the account's live
-- work but recorded nothing on the account, so every rule that names an owner
-- for NEW work kept choosing it: the workroom drive read the room's historical
-- requester, and the scheduled-task seeds read "the oldest superuser". The
-- account now records that its work was handed over, and those rules skip it.
--
-- Additive: two nullable columns, a self-referencing FK and its index.
ALTER TABLE "User" ADD COLUMN IF NOT EXISTS "workHandedOverAt" TIMESTAMP(3);
ALTER TABLE "User" ADD COLUMN IF NOT EXISTS "workHandedOverById" TEXT;
CREATE INDEX IF NOT EXISTS "User_workHandedOverById_idx" ON "User"("workHandedOverById");
-- @migration-safety: data-safe: workHandedOverById is added by this migration and every row holds NULL when the FK is created; NULL never violates a foreign key, and the backfill below never writes this column.
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'User_workHandedOverById_fkey') THEN
    ALTER TABLE "User" ADD CONSTRAINT "User_workHandedOverById_fkey"
      FOREIGN KEY ("workHandedOverById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;
END $$;

-- Backfill from what a past apply recorded: every re-homed build got a
-- BuildActivity row "Handed over from <email> (BI-F25A5FC7): <reason>". The
-- approver was not recorded then, so workHandedOverById stays NULL. An install
-- that never applied a handover matches no row. Re-runnable: only NULL markers
-- are written.
UPDATE "User" u
SET "workHandedOverAt" = h."handedOverAt"
FROM (
  SELECT substring("summary" FROM '^Handed over from (\S+) \(BI-F25A5FC7\)') AS "email",
         min("createdAt") AS "handedOverAt"
  FROM "BuildActivity"
  WHERE "tool" = 'apply_account_handover'
  GROUP BY 1
) h
WHERE h."email" IS NOT NULL
  AND u."email" = h."email"
  AND u."workHandedOverAt" IS NULL;
