-- BI-9EC60FE0 (slice 3 of EP-PORTFOLIO-BUDGET-WIP): quarterly portfolio budgets
-- in investment points.
--
-- Forward-only and additive: a new table with no backfill, so it applies the same
-- against an empty schema and a populated one. IF NOT EXISTS and the DO blocks
-- keep a re-run harmless.
CREATE TABLE IF NOT EXISTS "PortfolioBudgetPeriod" (
  "id" TEXT NOT NULL,
  "portfolioId" TEXT NOT NULL,
  "periodStart" TIMESTAMP(3) NOT NULL,
  "periodEnd" TIMESTAMP(3) NOT NULL,
  "allocatedPoints" INTEGER NOT NULL,
  "usdPerPoint" DECIMAL(12,2),
  "wipAllowancePoints" INTEGER,
  "setById" TEXT NOT NULL,
  "setByAgentId" TEXT,
  "reason" TEXT NOT NULL,
  "supersedesId" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "PortfolioBudgetPeriod_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "PortfolioBudgetPeriod_supersedesId_key" ON "PortfolioBudgetPeriod"("supersedesId");
CREATE INDEX IF NOT EXISTS "PortfolioBudgetPeriod_portfolioId_periodStart_idx" ON "PortfolioBudgetPeriod"("portfolioId", "periodStart");
CREATE INDEX IF NOT EXISTS "PortfolioBudgetPeriod_setById_idx" ON "PortfolioBudgetPeriod"("setById");
CREATE INDEX IF NOT EXISTS "PortfolioBudgetPeriod_setByAgentId_idx" ON "PortfolioBudgetPeriod"("setByAgentId");
-- One supersession chain per portfolio and period: only one row may start a
-- chain, and supersedesId is unique, so the chain is a single line with exactly
-- one current row (its tail). A racing second write loses on the unique index.
CREATE UNIQUE INDEX IF NOT EXISTS "PortfolioBudgetPeriod_one_root_per_period"
  ON "PortfolioBudgetPeriod"("portfolioId", "periodStart") WHERE "supersedesId" IS NULL;

-- @migration-safety: data-safe: the table is created empty in this same migration, so no row can violate these constraints.
DO $$ BEGIN
  ALTER TABLE "PortfolioBudgetPeriod" ADD CONSTRAINT "PortfolioBudgetPeriod_portfolioId_fkey"
    FOREIGN KEY ("portfolioId") REFERENCES "Portfolio"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;
-- @migration-safety: data-safe: the table is created empty in this same migration.
DO $$ BEGIN
  ALTER TABLE "PortfolioBudgetPeriod" ADD CONSTRAINT "PortfolioBudgetPeriod_setById_fkey"
    FOREIGN KEY ("setById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;
-- @migration-safety: data-safe: the table is created empty in this same migration.
DO $$ BEGIN
  ALTER TABLE "PortfolioBudgetPeriod" ADD CONSTRAINT "PortfolioBudgetPeriod_setByAgentId_fkey"
    FOREIGN KEY ("setByAgentId") REFERENCES "Agent"("agentId") ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;
-- @migration-safety: data-safe: the table is created empty in this same migration.
DO $$ BEGIN
  ALTER TABLE "PortfolioBudgetPeriod" ADD CONSTRAINT "PortfolioBudgetPeriod_supersedesId_fkey"
    FOREIGN KEY ("supersedesId") REFERENCES "PortfolioBudgetPeriod"("id") ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;
