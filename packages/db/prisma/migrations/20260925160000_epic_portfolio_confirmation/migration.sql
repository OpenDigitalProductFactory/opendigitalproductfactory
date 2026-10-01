-- BI-A73A7DA3 (slice 2 of EP-PORTFOLIO-BUDGET-WIP): an epic's portfolio
-- attribution records who confirmed it, why, and how confident the proposal was.
--
-- Forward-only and additive. Every column is nullable, so existing rows (written
-- by the epic edit form, the ops epics API and auto-intake, none of which record
-- an actor) stay valid and read as "no confirmation recorded". IF NOT EXISTS and
-- the DO block keep a re-run harmless against any data state.
DO $$ BEGIN
  CREATE TYPE "EpicPortfolioConfidence" AS ENUM ('high', 'low');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

ALTER TABLE "EpicPortfolio"
  ADD COLUMN IF NOT EXISTS "confirmedById" TEXT,
  ADD COLUMN IF NOT EXISTS "confirmedByAgentId" TEXT,
  ADD COLUMN IF NOT EXISTS "confirmationReason" TEXT,
  ADD COLUMN IF NOT EXISTS "confirmedAt" TIMESTAMP(3),
  ADD COLUMN IF NOT EXISTS "proposalConfidence" "EpicPortfolioConfidence";

CREATE INDEX IF NOT EXISTS "EpicPortfolio_confirmedById_idx" ON "EpicPortfolio"("confirmedById");
CREATE INDEX IF NOT EXISTS "EpicPortfolio_confirmedByAgentId_idx" ON "EpicPortfolio"("confirmedByAgentId");

-- The columns are new, so no existing row can be orphaned; the constraints are
-- still added only when absent, so a re-run is harmless.
-- @migration-safety: data-safe: confirmedById is added earlier in this same migration, so every existing row holds NULL and no row can violate the foreign key.
DO $$ BEGIN
  ALTER TABLE "EpicPortfolio" ADD CONSTRAINT "EpicPortfolio_confirmedById_fkey"
    FOREIGN KEY ("confirmedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;
-- @migration-safety: data-safe: confirmedByAgentId is added earlier in this same migration, so every existing row holds NULL and no row can violate the foreign key.
DO $$ BEGIN
  ALTER TABLE "EpicPortfolio" ADD CONSTRAINT "EpicPortfolio_confirmedByAgentId_fkey"
    FOREIGN KEY ("confirmedByAgentId") REFERENCES "Agent"("agentId") ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;
