-- Marketing asset A/B variants (EP-MARKETING-EXEC parity slice B). Additive only:
-- new MarketingAssetVariant table with inline measured metrics and an FK to
-- MarketingAssetTask, so winner selection is a pure function of the variant rows.

-- CreateTable
CREATE TABLE "MarketingAssetVariant" (
    "variantId" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "taskId" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "hypothesis" TEXT,
    "headline" TEXT,
    "body" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'draft',
    "impressions" INTEGER NOT NULL DEFAULT 0,
    "clicks" INTEGER NOT NULL DEFAULT 0,
    "conversions" INTEGER NOT NULL DEFAULT 0,
    "createdByAgentId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "MarketingAssetVariant_pkey" PRIMARY KEY ("variantId")
);

-- CreateIndex
CREATE INDEX "MarketingAssetVariant_organizationId_createdAt_idx" ON "MarketingAssetVariant"("organizationId", "createdAt");

-- CreateIndex
CREATE INDEX "MarketingAssetVariant_taskId_idx" ON "MarketingAssetVariant"("taskId");

-- CreateIndex
CREATE INDEX "MarketingAssetVariant_status_idx" ON "MarketingAssetVariant"("status");

-- AddForeignKey
ALTER TABLE "MarketingAssetVariant" ADD CONSTRAINT "MarketingAssetVariant_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MarketingAssetVariant" ADD CONSTRAINT "MarketingAssetVariant_taskId_fkey" FOREIGN KEY ("taskId") REFERENCES "MarketingAssetTask"("taskId") ON DELETE CASCADE ON UPDATE CASCADE;
