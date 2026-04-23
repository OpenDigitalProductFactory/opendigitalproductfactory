-- CreateTable
CREATE TABLE "CustomerConfigurationItem" (
    "id" TEXT NOT NULL,
    "customerCiId" TEXT NOT NULL,
    "accountId" TEXT NOT NULL,
    "siteId" TEXT,
    "name" TEXT NOT NULL,
    "ciType" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'active',
    "technologySourceType" TEXT NOT NULL DEFAULT 'commercial',
    "supportModel" TEXT,
    "manufacturer" TEXT,
    "vendorName" TEXT,
    "productName" TEXT,
    "edition" TEXT,
    "productModel" TEXT,
    "serialNumber" TEXT,
    "assetTag" TEXT,
    "observedVersion" TEXT,
    "normalizedVersion" TEXT,
    "installDate" TIMESTAMP(3),
    "purchaseDate" TIMESTAMP(3),
    "firstSeenAt" TIMESTAMP(3),
    "warrantyStartAt" TIMESTAMP(3),
    "warrantyEndAt" TIMESTAMP(3),
    "endOfSaleAt" TIMESTAMP(3),
    "endOfSupportAt" TIMESTAMP(3),
    "endOfLifeAt" TIMESTAMP(3),
    "renewalDate" TIMESTAMP(3),
    "lifecycleStatus" TEXT NOT NULL DEFAULT 'unknown',
    "supportStatus" TEXT NOT NULL DEFAULT 'unknown',
    "recommendedAction" TEXT,
    "lifecycleConfidence" DOUBLE PRECISION,
    "lastLifecycleReviewAt" TIMESTAMP(3),
    "nextLifecycleReviewAt" TIMESTAMP(3),
    "lifecycleEvidence" JSONB,
    "licenseQuantity" DECIMAL(12,2),
    "billingCadence" TEXT,
    "customerChargeModel" TEXT,
    "unitCost" DECIMAL(12,2),
    "customerUnitPrice" DECIMAL(12,2),
    "currency" TEXT NOT NULL DEFAULT 'GBP',
    "properties" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CustomerConfigurationItem_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "CustomerConfigurationItem_customerCiId_key" ON "CustomerConfigurationItem"("customerCiId");

-- CreateIndex
CREATE INDEX "CustomerConfigurationItem_accountId_idx" ON "CustomerConfigurationItem"("accountId");

-- CreateIndex
CREATE INDEX "CustomerConfigurationItem_siteId_idx" ON "CustomerConfigurationItem"("siteId");

-- CreateIndex
CREATE INDEX "CustomerConfigurationItem_ciType_idx" ON "CustomerConfigurationItem"("ciType");

-- CreateIndex
CREATE INDEX "CustomerConfigurationItem_status_idx" ON "CustomerConfigurationItem"("status");

-- CreateIndex
CREATE INDEX "CustomerConfigurationItem_technologySourceType_idx" ON "CustomerConfigurationItem"("technologySourceType");

-- AddForeignKey
ALTER TABLE "CustomerConfigurationItem" ADD CONSTRAINT "CustomerConfigurationItem_accountId_fkey" FOREIGN KEY ("accountId") REFERENCES "CustomerAccount"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CustomerConfigurationItem" ADD CONSTRAINT "CustomerConfigurationItem_siteId_fkey" FOREIGN KEY ("siteId") REFERENCES "CustomerSite"("id") ON DELETE SET NULL ON UPDATE CASCADE;
