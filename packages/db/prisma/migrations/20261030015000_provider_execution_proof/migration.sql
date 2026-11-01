-- BI-D81CCC24: optional bounded model/endpoint proof on existing capacity owner.
-- Existing rows remain NULL; no rewrite, backfill, data deletion or new ledger.
ALTER TABLE "ProviderCapacityStatus" ADD COLUMN "executionProof" JSONB;
