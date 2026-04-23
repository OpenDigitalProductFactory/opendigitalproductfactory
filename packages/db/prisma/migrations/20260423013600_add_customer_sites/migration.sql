-- CreateTable
CREATE TABLE "CustomerSite" (
    "id" TEXT NOT NULL,
    "siteId" TEXT NOT NULL,
    "accountId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "siteType" TEXT NOT NULL DEFAULT 'office',
    "status" TEXT NOT NULL DEFAULT 'active',
    "primaryAddressId" TEXT,
    "timezone" TEXT,
    "accessInstructions" TEXT,
    "hoursNotes" TEXT,
    "serviceNotes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CustomerSite_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CustomerSiteNode" (
    "id" TEXT NOT NULL,
    "nodeId" TEXT NOT NULL,
    "siteId" TEXT NOT NULL,
    "parentNodeId" TEXT,
    "name" TEXT NOT NULL,
    "nodeType" TEXT NOT NULL DEFAULT 'area',
    "status" TEXT NOT NULL DEFAULT 'active',
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CustomerSiteNode_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "CustomerSite_siteId_key" ON "CustomerSite"("siteId");

-- CreateIndex
CREATE INDEX "CustomerSite_accountId_idx" ON "CustomerSite"("accountId");

-- CreateIndex
CREATE INDEX "CustomerSite_primaryAddressId_idx" ON "CustomerSite"("primaryAddressId");

-- CreateIndex
CREATE INDEX "CustomerSite_status_idx" ON "CustomerSite"("status");

-- CreateIndex
CREATE INDEX "CustomerSite_siteType_idx" ON "CustomerSite"("siteType");

-- CreateIndex
CREATE UNIQUE INDEX "CustomerSiteNode_nodeId_key" ON "CustomerSiteNode"("nodeId");

-- CreateIndex
CREATE INDEX "CustomerSiteNode_siteId_idx" ON "CustomerSiteNode"("siteId");

-- CreateIndex
CREATE INDEX "CustomerSiteNode_parentNodeId_idx" ON "CustomerSiteNode"("parentNodeId");

-- CreateIndex
CREATE INDEX "CustomerSiteNode_status_idx" ON "CustomerSiteNode"("status");

-- CreateIndex
CREATE INDEX "CustomerSiteNode_nodeType_idx" ON "CustomerSiteNode"("nodeType");

-- AddForeignKey
ALTER TABLE "CustomerSite" ADD CONSTRAINT "CustomerSite_accountId_fkey" FOREIGN KEY ("accountId") REFERENCES "CustomerAccount"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CustomerSite" ADD CONSTRAINT "CustomerSite_primaryAddressId_fkey" FOREIGN KEY ("primaryAddressId") REFERENCES "Address"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CustomerSiteNode" ADD CONSTRAINT "CustomerSiteNode_siteId_fkey" FOREIGN KEY ("siteId") REFERENCES "CustomerSite"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CustomerSiteNode" ADD CONSTRAINT "CustomerSiteNode_parentNodeId_fkey" FOREIGN KEY ("parentNodeId") REFERENCES "CustomerSiteNode"("id") ON DELETE CASCADE ON UPDATE CASCADE;
