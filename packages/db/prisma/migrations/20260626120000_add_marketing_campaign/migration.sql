-- Marketing campaign aggregate (EP-MARKETING-EXEC). Additive only:
-- new MarketingCampaign table + nullable campaignId FK on brief/task so
-- the campaigns view uses a real relation instead of fuzzy string matching.
-- Legacy rows keep campaignId NULL and fall back to fuzzy matching.

-- AlterTable
ALTER TABLE "MarketingCampaignBrief" ADD COLUMN     "campaignId" TEXT;

-- AlterTable
ALTER TABLE "MarketingAssetTask" ADD COLUMN     "campaignId" TEXT;

-- CreateTable
CREATE TABLE "MarketingCampaign" (
    "campaignId" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "strategyId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "objective" TEXT NOT NULL,
    "audience" TEXT,
    "channels" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "status" TEXT NOT NULL DEFAULT 'draft',
    "budgetTotalCents" INTEGER,
    "budgetByChannel" JSONB,
    "startDate" TIMESTAMP(3),
    "endDate" TIMESTAMP(3),
    "kpiTargets" JSONB,
    "primaryCta" TEXT,
    "notes" TEXT,
    "createdByAgentId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "MarketingCampaign_pkey" PRIMARY KEY ("campaignId")
);

-- CreateIndex
CREATE INDEX "MarketingCampaign_organizationId_createdAt_idx" ON "MarketingCampaign"("organizationId", "createdAt");

-- CreateIndex
CREATE INDEX "MarketingCampaign_strategyId_createdAt_idx" ON "MarketingCampaign"("strategyId", "createdAt");

-- CreateIndex
CREATE INDEX "MarketingCampaign_status_idx" ON "MarketingCampaign"("status");

-- CreateIndex
CREATE INDEX "MarketingCampaignBrief_campaignId_idx" ON "MarketingCampaignBrief"("campaignId");

-- CreateIndex
CREATE INDEX "MarketingAssetTask_campaignId_idx" ON "MarketingAssetTask"("campaignId");

-- AddForeignKey
ALTER TABLE "MarketingCampaign" ADD CONSTRAINT "MarketingCampaign_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MarketingCampaign" ADD CONSTRAINT "MarketingCampaign_strategyId_fkey" FOREIGN KEY ("strategyId") REFERENCES "MarketingStrategy"("strategyId") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MarketingCampaignBrief" ADD CONSTRAINT "MarketingCampaignBrief_campaignId_fkey" FOREIGN KEY ("campaignId") REFERENCES "MarketingCampaign"("campaignId") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MarketingAssetTask" ADD CONSTRAINT "MarketingAssetTask_campaignId_fkey" FOREIGN KEY ("campaignId") REFERENCES "MarketingCampaign"("campaignId") ON DELETE SET NULL ON UPDATE CASCADE;

