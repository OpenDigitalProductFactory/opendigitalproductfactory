-- BI-EF265C9A (slice 4 of EP-PORTFOLIO-BUDGET-WIP): funding approval reserves
-- an item's points against its portfolio's quarterly budget.
--
-- Forward-only and additive: a new enum and a new empty table, no backfill.
-- IF NOT EXISTS and the DO blocks keep a re-run harmless.
DO $$ BEGIN
  CREATE TYPE "BudgetReservationState" AS ENUM ('reserved', 'consumed', 'released');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

CREATE TABLE IF NOT EXISTS "BudgetReservation" (
  "id" TEXT NOT NULL,
  "backlogItemId" TEXT NOT NULL,
  "portfolioId" TEXT NOT NULL,
  "periodStart" TIMESTAMP(3) NOT NULL,
  "periodEnd" TIMESTAMP(3) NOT NULL,
  "points" INTEGER NOT NULL,
  "state" "BudgetReservationState" NOT NULL DEFAULT 'reserved',
  "overrideReason" TEXT,
  "actorId" TEXT,
  "actorAgentId" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "settledAt" TIMESTAMP(3),
  CONSTRAINT "BudgetReservation_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "BudgetReservation_backlogItemId_idx" ON "BudgetReservation"("backlogItemId");
CREATE INDEX IF NOT EXISTS "BudgetReservation_portfolioId_periodStart_state_idx" ON "BudgetReservation"("portfolioId", "periodStart", "state");
CREATE INDEX IF NOT EXISTS "BudgetReservation_actorId_idx" ON "BudgetReservation"("actorId");
CREATE INDEX IF NOT EXISTS "BudgetReservation_actorAgentId_idx" ON "BudgetReservation"("actorAgentId");
-- One open reservation per item, so a repeated approval never double-counts.
CREATE UNIQUE INDEX IF NOT EXISTS "BudgetReservation_one_open_per_item"
  ON "BudgetReservation"("backlogItemId") WHERE "state" = 'reserved';

-- @migration-safety: data-safe: the table is created empty in this same migration, so no row can violate these constraints.
DO $$ BEGIN
  ALTER TABLE "BudgetReservation" ADD CONSTRAINT "BudgetReservation_backlogItemId_fkey"
    FOREIGN KEY ("backlogItemId") REFERENCES "BacklogItem"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;
-- @migration-safety: data-safe: the table is created empty in this same migration.
DO $$ BEGIN
  ALTER TABLE "BudgetReservation" ADD CONSTRAINT "BudgetReservation_portfolioId_fkey"
    FOREIGN KEY ("portfolioId") REFERENCES "Portfolio"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;
-- @migration-safety: data-safe: the table is created empty in this same migration.
DO $$ BEGIN
  ALTER TABLE "BudgetReservation" ADD CONSTRAINT "BudgetReservation_actorId_fkey"
    FOREIGN KEY ("actorId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;
-- @migration-safety: data-safe: the table is created empty in this same migration.
DO $$ BEGIN
  ALTER TABLE "BudgetReservation" ADD CONSTRAINT "BudgetReservation_actorAgentId_fkey"
    FOREIGN KEY ("actorAgentId") REFERENCES "Agent"("agentId") ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;
