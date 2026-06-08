-- AI/vendor subscription traceability.
-- A single supplier contract can represent one recurring subscription charge
-- while covering multiple AI provider rows, and AP bills can be linked back to
-- that subscription contract for spend reporting.

ALTER TABLE "SupplierContract"
  ADD COLUMN IF NOT EXISTS "billingDayOfMonth" INTEGER,
  ADD COLUMN IF NOT EXISTS "paymentMethod" TEXT,
  ADD COLUMN IF NOT EXISTS "paymentReference" TEXT,
  ADD COLUMN IF NOT EXISTS "coveredProviderIds" JSONB;

ALTER TABLE "Bill"
  ADD COLUMN IF NOT EXISTS "supplierContractId" TEXT;

CREATE INDEX IF NOT EXISTS "Bill_supplierContractId_idx"
  ON "Bill"("supplierContractId");

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'SupplierContract_billingDayOfMonth_check'
  ) THEN
    ALTER TABLE "SupplierContract"
      ADD CONSTRAINT "SupplierContract_billingDayOfMonth_check"
      CHECK ("billingDayOfMonth" IS NULL OR ("billingDayOfMonth" >= 1 AND "billingDayOfMonth" <= 31));
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'Bill_supplierContractId_fkey'
  ) THEN
    ALTER TABLE "Bill"
      ADD CONSTRAINT "Bill_supplierContractId_fkey"
      FOREIGN KEY ("supplierContractId")
      REFERENCES "SupplierContract"("id")
      ON DELETE SET NULL
      ON UPDATE CASCADE;
  END IF;
END $$;
