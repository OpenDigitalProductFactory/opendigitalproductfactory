-- EP-MSP-FEDERATION · A1 (BI-8777B85A) — per-customer/site routing scope on the
-- operator quality-issue inbox. Nullable + additive: existing self-monitoring
-- rows stay NULL (organization-internal), preserving current behavior. Scope is
-- denormalized from the originating EdgeNode / InventoryEntity via the
-- estate-scope resolver so a firing issue routes to the right customer queue
-- instead of one global inbox. The owning row stays the canonical scope source;
-- these columns are a routing read model.
ALTER TABLE "PortfolioQualityIssue" ADD COLUMN "customerAccountId" TEXT;
ALTER TABLE "PortfolioQualityIssue" ADD COLUMN "customerSiteId" TEXT;
ALTER TABLE "PortfolioQualityIssue" ADD COLUMN "scopeKey" TEXT;

CREATE INDEX "PortfolioQualityIssue_customerAccountId_idx" ON "PortfolioQualityIssue"("customerAccountId");
CREATE INDEX "PortfolioQualityIssue_customerSiteId_idx" ON "PortfolioQualityIssue"("customerSiteId");
CREATE INDEX "PortfolioQualityIssue_scopeKey_idx" ON "PortfolioQualityIssue"("scopeKey");

ALTER TABLE "PortfolioQualityIssue" ADD CONSTRAINT "PortfolioQualityIssue_customerAccountId_fkey" FOREIGN KEY ("customerAccountId") REFERENCES "CustomerAccount"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "PortfolioQualityIssue" ADD CONSTRAINT "PortfolioQualityIssue_customerSiteId_fkey" FOREIGN KEY ("customerSiteId") REFERENCES "CustomerSite"("id") ON DELETE SET NULL ON UPDATE CASCADE;
