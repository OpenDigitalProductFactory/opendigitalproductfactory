-- BI-67B27832: one accountable human per portfolio. Automatic work (scheduled
-- builds, their rooms, the approvals they raise) is owned by its portfolio's
-- accountable person instead of the oldest superuser.
--
-- Forward-only and additive. Every column is nullable and nothing is
-- backfilled: an owner is a decision a person records, never derived, so every
-- existing portfolio reads as "not set". IF NOT EXISTS and the DO blocks keep a
-- re-run harmless against any data state; the foreign keys are satisfied by the
-- all-NULL columns.
ALTER TABLE "Portfolio"
  ADD COLUMN IF NOT EXISTS "accountablePrincipalId" TEXT,
  ADD COLUMN IF NOT EXISTS "accountableSetById" TEXT,
  ADD COLUMN IF NOT EXISTS "accountableSetAt" TIMESTAMP(3),
  ADD COLUMN IF NOT EXISTS "accountableReason" TEXT;

CREATE INDEX IF NOT EXISTS "Portfolio_accountablePrincipalId_idx" ON "Portfolio"("accountablePrincipalId");
CREATE INDEX IF NOT EXISTS "Portfolio_accountableSetById_idx" ON "Portfolio"("accountableSetById");

-- @migration-safety: data-safe: "accountablePrincipalId" is created by this migration and every existing row holds NULL, which a foreign key never rejects.
DO $$ BEGIN
  ALTER TABLE "Portfolio" ADD CONSTRAINT "Portfolio_accountablePrincipalId_fkey"
    FOREIGN KEY ("accountablePrincipalId") REFERENCES "Principal"("id") ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- @migration-safety: data-safe: "accountableSetById" is created by this migration and every existing row holds NULL, which a foreign key never rejects.
DO $$ BEGIN
  ALTER TABLE "Portfolio" ADD CONSTRAINT "Portfolio_accountableSetById_fkey"
    FOREIGN KEY ("accountableSetById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;
