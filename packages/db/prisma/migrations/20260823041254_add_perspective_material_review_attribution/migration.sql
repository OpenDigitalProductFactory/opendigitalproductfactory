-- Records who released profession material from the high-stakes review hold
-- and when (BI-5F3BFD13). Both nullable and additive: material that was never
-- held, and every row predating this migration, stays valid with NULLs. No
-- backfill — a NULL here means "never went through the hold", which is exactly
-- true of existing rows, and inventing an approver for them would be a
-- fabricated audit trail.
ALTER TABLE "PerspectiveMaterial" ADD COLUMN IF NOT EXISTS "reviewedByUserId" TEXT;
ALTER TABLE "PerspectiveMaterial" ADD COLUMN IF NOT EXISTS "reviewedAt" TIMESTAMP(3);
