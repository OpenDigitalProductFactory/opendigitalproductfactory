-- Compliance & regulatory scope captured at setup, on BusinessContext.
-- Region is multi-dimensional: where the business operates / sells / employs /
-- needs data residency, plus whether it handles card payments (PCI-DSS).
-- These drive per-coworker profession-corpus selection via the jurisdiction-basis
-- model. Additive only — all columns are defaulted/nullable, existing rows are
-- unaffected.

-- AlterTable
ALTER TABLE "BusinessContext"
  ADD COLUMN "operatesIn" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
  ADD COLUMN "sellsTo" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
  ADD COLUMN "employsIn" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
  ADD COLUMN "dataResidency" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
  ADD COLUMN "handlesCardPayments" BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN "complianceScopeCapturedAt" TIMESTAMP(3);
