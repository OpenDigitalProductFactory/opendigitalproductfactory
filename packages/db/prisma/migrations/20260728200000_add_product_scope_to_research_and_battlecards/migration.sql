-- @migration-safety: data-safe: both scope columns are nullable, so every
-- existing organization-wide row remains valid without an inferred backfill.
ALTER TABLE "ResearchProposal"
  ADD COLUMN "digitalProductId" TEXT;

ALTER TABLE "MarketingBattlecard"
  ADD COLUMN "digitalProductId" TEXT;

CREATE INDEX "ResearchProposal_digitalProductId_idx"
  ON "ResearchProposal"("digitalProductId");

CREATE INDEX "MarketingBattlecard_digitalProductId_idx"
  ON "MarketingBattlecard"("digitalProductId");

-- @migration-safety: data-safe: NULL values do not participate in these
-- foreign keys. RESTRICT preserves product-scope traceability instead of
-- silently recasting product-specific evidence as organization-wide.
ALTER TABLE "ResearchProposal"
  ADD CONSTRAINT "ResearchProposal_digitalProductId_fkey"
  FOREIGN KEY ("digitalProductId") REFERENCES "DigitalProduct"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "MarketingBattlecard"
  ADD CONSTRAINT "MarketingBattlecard_digitalProductId_fkey"
  FOREIGN KEY ("digitalProductId") REFERENCES "DigitalProduct"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE;
