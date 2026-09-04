-- Payroll tax persistence: normalize period component totals, and model the
-- deposit cadence determination (BI-947F8703 items 3 and 5, DI-31F2D7D10E25).
--
-- WHY NOT TWO MORE COLUMNS. TaxObligationPeriod carried salesTaxAmount and
-- inputTaxAmount. Payroll needs employee-withheld and employer-contribution
-- totals on the same spine. Adding them as columns would make four, each
-- family's pair dead weight on every other family's rows, and the next family
-- would make six. One row per component per period scales by enum value.

CREATE TYPE "TaxPeriodComponentKind" AS ENUM (
  'sales_output',
  'sales_input',
  'employee_withheld',
  'employer_contribution'
);

CREATE TYPE "TaxDepositCadence" AS ENUM (
  'semiweekly',
  'monthly',
  'quarterly',
  'annual'
);

CREATE TABLE "TaxObligationPeriodComponent" (
  "id"            TEXT NOT NULL,
  "taxObligationPeriodComponentId"   TEXT NOT NULL,
  "periodId"      TEXT NOT NULL,
  "componentKind" "TaxPeriodComponentKind" NOT NULL,
  "amount"        DECIMAL(65,30) NOT NULL DEFAULT 0,
  "createdAt"     TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt"     TIMESTAMP(3) NOT NULL,
  CONSTRAINT "TaxObligationPeriodComponent_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "TaxObligationPeriodComponent_taxObligationPeriodComponentId_key"
  ON "TaxObligationPeriodComponent"("taxObligationPeriodComponentId");
CREATE UNIQUE INDEX "TaxObligationPeriodComponent_periodId_componentKind_key"
  ON "TaxObligationPeriodComponent"("periodId", "componentKind");
CREATE INDEX "TaxObligationPeriodComponent_periodId_idx"
  ON "TaxObligationPeriodComponent"("periodId");

ALTER TABLE "TaxObligationPeriodComponent"
  ADD CONSTRAINT "TaxObligationPeriodComponent_periodId_fkey"
  FOREIGN KEY ("periodId") REFERENCES "TaxObligationPeriod"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;

-- BACKFILL BEFORE DROP. Every existing sales total becomes a component row, so
-- no filed or draft period loses its figures. Zero amounts are carried too: a
-- recorded zero on an existing period is a stated fact ("nothing was charged"),
-- unlike an absent row, and collapsing the two would silently reinterpret
-- history. New periods simply never write a zero row.
INSERT INTO "TaxObligationPeriodComponent"
  ("id", "taxObligationPeriodComponentId", "periodId", "componentKind", "amount", "createdAt", "updatedAt")
SELECT
  md5(random()::text || clock_timestamp()::text || p."id" || 'sales_output'),
  'TPC-' || p."periodId" || '-SALES-OUTPUT',
  p."id",
  'sales_output'::"TaxPeriodComponentKind",
  p."salesTaxAmount",
  p."createdAt",
  CURRENT_TIMESTAMP
FROM "TaxObligationPeriod" p;

INSERT INTO "TaxObligationPeriodComponent"
  ("id", "taxObligationPeriodComponentId", "periodId", "componentKind", "amount", "createdAt", "updatedAt")
SELECT
  md5(random()::text || clock_timestamp()::text || p."id" || 'sales_input'),
  'TPC-' || p."periodId" || '-SALES-INPUT',
  p."id",
  'sales_input'::"TaxPeriodComponentKind",
  p."inputTaxAmount",
  p."createdAt",
  CURRENT_TIMESTAMP
FROM "TaxObligationPeriod" p;

-- Safe to drop only because every value above now lives in a component row.
-- netTaxAmount deliberately STAYS on the period: a filed return's bottom line
-- must remain frozen even if a component is later corrected.
ALTER TABLE "TaxObligationPeriod" DROP COLUMN "salesTaxAmount";
ALTER TABLE "TaxObligationPeriod" DROP COLUMN "inputTaxAmount";

CREATE TABLE "TaxDepositSchedule" (
  "id"                TEXT NOT NULL,
  "taxDepositScheduleId" TEXT NOT NULL,
  "registrationId"    TEXT NOT NULL,
  "cadence"           "TaxDepositCadence" NOT NULL,
  "effectiveFrom"     TIMESTAMP(3) NOT NULL,
  "effectiveTo"       TIMESTAMP(3),
  "lookbackTotal"     DECIMAL(65,30),
  "lookbackThreshold" DECIMAL(65,30),
  "lookbackStart"     TIMESTAMP(3),
  "lookbackEnd"       TIMESTAMP(3),
  "sourceUrl"         TEXT,
  "determinedAt"      TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "notes"             TEXT,
  "lifecycle"         "RecordLifecycle" NOT NULL DEFAULT 'active',
  "lifecycleAt"       TIMESTAMP(3),
  "lifecycleReason"   TEXT,
  "createdAt"         TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt"         TIMESTAMP(3) NOT NULL,
  CONSTRAINT "TaxDepositSchedule_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "TaxDepositSchedule_taxDepositScheduleId_key"
  ON "TaxDepositSchedule"("taxDepositScheduleId");
CREATE UNIQUE INDEX "TaxDepositSchedule_registrationId_effectiveFrom_key"
  ON "TaxDepositSchedule"("registrationId", "effectiveFrom");
CREATE INDEX "TaxDepositSchedule_registrationId_effectiveFrom_effectiveTo_idx"
  ON "TaxDepositSchedule"("registrationId", "effectiveFrom", "effectiveTo");
CREATE INDEX "TaxDepositSchedule_registrationId_lifecycle_idx"
  ON "TaxDepositSchedule"("registrationId", "lifecycle");

ALTER TABLE "TaxDepositSchedule"
  ADD CONSTRAINT "TaxDepositSchedule_registrationId_fkey"
  FOREIGN KEY ("registrationId") REFERENCES "TaxRegistration"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;

-- No deposit schedules are seeded. A cadence is a DETERMINATION against a
-- published threshold, and inventing one would fabricate the evidence a filing
-- relies on. Installs record their own, cited (BI-4EB27955).
