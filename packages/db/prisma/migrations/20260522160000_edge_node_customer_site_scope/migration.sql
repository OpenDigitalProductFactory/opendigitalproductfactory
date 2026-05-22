-- Bind Edge Nodes, bootstrap tokens, adapter connections, and submitted
-- discovery runs to customer-estate scope. All fields are nullable so
-- existing organization-scoped installs continue to operate unchanged.

ALTER TABLE "EdgeNode"
  ADD COLUMN "customerAccountId" TEXT,
  ADD COLUMN "customerSiteId" TEXT,
  ADD COLUMN "scopePolicy" JSONB;

ALTER TABLE "BootstrapToken"
  ADD COLUMN "targetCustomerAccountId" TEXT,
  ADD COLUMN "targetCustomerSiteId" TEXT,
  ADD COLUMN "scopePolicy" JSONB;

ALTER TABLE "DiscoveryRun"
  ADD COLUMN "customerAccountId" TEXT,
  ADD COLUMN "customerSiteId" TEXT;

ALTER TABLE "DiscoveryConnection"
  ADD COLUMN "customerAccountId" TEXT,
  ADD COLUMN "customerSiteId" TEXT,
  ADD COLUMN "targetEdgeNodeId" TEXT;

ALTER TABLE "EdgeNode"
  ADD CONSTRAINT "EdgeNode_customerAccountId_fkey"
    FOREIGN KEY ("customerAccountId") REFERENCES "CustomerAccount"("id")
    ON DELETE SET NULL ON UPDATE CASCADE,
  ADD CONSTRAINT "EdgeNode_customerSiteId_fkey"
    FOREIGN KEY ("customerSiteId") REFERENCES "CustomerSite"("id")
    ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "BootstrapToken"
  ADD CONSTRAINT "BootstrapToken_targetCustomerAccountId_fkey"
    FOREIGN KEY ("targetCustomerAccountId") REFERENCES "CustomerAccount"("id")
    ON DELETE SET NULL ON UPDATE CASCADE,
  ADD CONSTRAINT "BootstrapToken_targetCustomerSiteId_fkey"
    FOREIGN KEY ("targetCustomerSiteId") REFERENCES "CustomerSite"("id")
    ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "DiscoveryRun"
  ADD CONSTRAINT "DiscoveryRun_customerAccountId_fkey"
    FOREIGN KEY ("customerAccountId") REFERENCES "CustomerAccount"("id")
    ON DELETE SET NULL ON UPDATE CASCADE,
  ADD CONSTRAINT "DiscoveryRun_customerSiteId_fkey"
    FOREIGN KEY ("customerSiteId") REFERENCES "CustomerSite"("id")
    ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "DiscoveryConnection"
  ADD CONSTRAINT "DiscoveryConnection_customerAccountId_fkey"
    FOREIGN KEY ("customerAccountId") REFERENCES "CustomerAccount"("id")
    ON DELETE SET NULL ON UPDATE CASCADE,
  ADD CONSTRAINT "DiscoveryConnection_customerSiteId_fkey"
    FOREIGN KEY ("customerSiteId") REFERENCES "CustomerSite"("id")
    ON DELETE SET NULL ON UPDATE CASCADE,
  ADD CONSTRAINT "DiscoveryConnection_targetEdgeNodeId_fkey"
    FOREIGN KEY ("targetEdgeNodeId") REFERENCES "EdgeNode"("id")
    ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "EdgeNode"
  ADD CONSTRAINT "EdgeNode_customer_site_requires_account"
    CHECK ("customerSiteId" IS NULL OR "customerAccountId" IS NOT NULL);

ALTER TABLE "BootstrapToken"
  ADD CONSTRAINT "BootstrapToken_target_site_requires_account"
    CHECK ("targetCustomerSiteId" IS NULL OR "targetCustomerAccountId" IS NOT NULL);

ALTER TABLE "DiscoveryRun"
  ADD CONSTRAINT "DiscoveryRun_customer_site_requires_account"
    CHECK ("customerSiteId" IS NULL OR "customerAccountId" IS NOT NULL);

ALTER TABLE "DiscoveryConnection"
  ADD CONSTRAINT "DiscoveryConnection_customer_site_requires_account"
    CHECK ("customerSiteId" IS NULL OR "customerAccountId" IS NOT NULL);

CREATE INDEX "EdgeNode_customerAccountId_idx" ON "EdgeNode"("customerAccountId");
CREATE INDEX "EdgeNode_customerSiteId_idx" ON "EdgeNode"("customerSiteId");

CREATE INDEX "BootstrapToken_targetCustomerAccountId_idx" ON "BootstrapToken"("targetCustomerAccountId");
CREATE INDEX "BootstrapToken_targetCustomerSiteId_idx" ON "BootstrapToken"("targetCustomerSiteId");

CREATE INDEX "DiscoveryRun_customerAccountId_idx" ON "DiscoveryRun"("customerAccountId");
CREATE INDEX "DiscoveryRun_customerSiteId_idx" ON "DiscoveryRun"("customerSiteId");

CREATE INDEX "DiscoveryConnection_customerAccountId_idx" ON "DiscoveryConnection"("customerAccountId");
CREATE INDEX "DiscoveryConnection_customerSiteId_idx" ON "DiscoveryConnection"("customerSiteId");
CREATE INDEX "DiscoveryConnection_targetEdgeNodeId_idx" ON "DiscoveryConnection"("targetEdgeNodeId");
