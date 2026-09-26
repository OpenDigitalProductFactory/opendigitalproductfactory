-- BI-3430B3A4 (slice 6 of EP-PORTFOLIO-BUDGET-WIP): points-in-flight admission
-- ships in shadow mode (WWMD DI-D83D9C13686B). The default is shadow, so every
-- existing install records admission decisions without blocking until an
-- operator switches it to enforce through set_backlog_delivery_budget.
--
-- Forward-only and additive: a new enum and a column with a default, which
-- applies the same against an empty table and a populated one.
DO $$ BEGIN
  CREATE TYPE "WipAdmissionMode" AS ENUM ('shadow', 'enforce');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

ALTER TABLE "PlatformDevConfig"
  ADD COLUMN IF NOT EXISTS "wipAdmissionMode" "WipAdmissionMode" NOT NULL DEFAULT 'shadow';
