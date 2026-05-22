-- Customer topology isolation: scope columns on inventory entities and relationships.
-- Backfill default 'organization:internal' is correct because the prior MSP customer-scope
-- foundation (PR #988) added scope only to EdgeNode / DiscoveryRun / DiscoveryConnection.
-- No customer-attributable InventoryEntity / InventoryRelationship rows exist yet on main,
-- so every existing row genuinely is internal MSP estate.

ALTER TABLE "InventoryEntity"
  ADD COLUMN "scopeKey" TEXT NOT NULL DEFAULT 'organization:internal',
  ADD COLUMN "customerAccountId" TEXT,
  ADD COLUMN "customerSiteId" TEXT;

ALTER TABLE "InventoryRelationship"
  ADD COLUMN "scopeKey" TEXT NOT NULL DEFAULT 'organization:internal',
  ADD COLUMN "customerAccountId" TEXT,
  ADD COLUMN "customerSiteId" TEXT;

CREATE INDEX "InventoryEntity_scopeKey_idx" ON "InventoryEntity"("scopeKey");
CREATE INDEX "InventoryEntity_customerAccountId_idx" ON "InventoryEntity"("customerAccountId");
CREATE INDEX "InventoryEntity_customerSiteId_idx" ON "InventoryEntity"("customerSiteId");
CREATE INDEX "InventoryRelationship_scopeKey_idx" ON "InventoryRelationship"("scopeKey");
CREATE INDEX "InventoryRelationship_customerAccountId_idx" ON "InventoryRelationship"("customerAccountId");
CREATE INDEX "InventoryRelationship_customerSiteId_idx" ON "InventoryRelationship"("customerSiteId");

ALTER TABLE "InventoryEntity"
  ADD CONSTRAINT "InventoryEntity_customerAccountId_fkey"
  FOREIGN KEY ("customerAccountId") REFERENCES "CustomerAccount"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "InventoryEntity"
  ADD CONSTRAINT "InventoryEntity_customerSiteId_fkey"
  FOREIGN KEY ("customerSiteId") REFERENCES "CustomerSite"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "InventoryRelationship"
  ADD CONSTRAINT "InventoryRelationship_customerAccountId_fkey"
  FOREIGN KEY ("customerAccountId") REFERENCES "CustomerAccount"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "InventoryRelationship"
  ADD CONSTRAINT "InventoryRelationship_customerSiteId_fkey"
  FOREIGN KEY ("customerSiteId") REFERENCES "CustomerSite"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;
