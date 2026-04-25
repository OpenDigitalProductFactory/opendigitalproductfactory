-- CreateTable
CREATE TABLE "DiscoveryTriageDecision" (
    "id" TEXT NOT NULL,
    "decisionId" TEXT NOT NULL,
    "inventoryEntityId" TEXT,
    "qualityIssueId" TEXT,
    "actorType" TEXT NOT NULL,
    "actorId" TEXT,
    "outcome" TEXT NOT NULL,
    "identityConfidence" DOUBLE PRECISION,
    "taxonomyConfidence" DOUBLE PRECISION,
    "evidenceCompleteness" DOUBLE PRECISION,
    "reproducibilityScore" DOUBLE PRECISION,
    "selectedTaxonomyNodeId" TEXT,
    "selectedIdentity" JSONB,
    "evidencePacket" JSONB NOT NULL,
    "proposedRule" JSONB,
    "appliedRuleId" TEXT,
    "requiresHumanReview" BOOLEAN NOT NULL DEFAULT false,
    "humanReviewedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "DiscoveryTriageDecision_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "DiscoveryTriageDecision_decisionId_key" ON "DiscoveryTriageDecision"("decisionId");

-- CreateIndex
CREATE INDEX "DiscoveryTriageDecision_outcome_idx" ON "DiscoveryTriageDecision"("outcome");

-- CreateIndex
CREATE INDEX "DiscoveryTriageDecision_inventoryEntityId_idx" ON "DiscoveryTriageDecision"("inventoryEntityId");

-- CreateIndex
CREATE INDEX "DiscoveryTriageDecision_qualityIssueId_idx" ON "DiscoveryTriageDecision"("qualityIssueId");

-- CreateIndex
CREATE INDEX "DiscoveryTriageDecision_selectedTaxonomyNodeId_idx" ON "DiscoveryTriageDecision"("selectedTaxonomyNodeId");

-- CreateIndex
CREATE INDEX "DiscoveryTriageDecision_requiresHumanReview_createdAt_idx" ON "DiscoveryTriageDecision"("requiresHumanReview", "createdAt");

-- AddForeignKey
ALTER TABLE "DiscoveryTriageDecision"
ADD CONSTRAINT "DiscoveryTriageDecision_inventoryEntityId_fkey"
FOREIGN KEY ("inventoryEntityId") REFERENCES "InventoryEntity"("id")
ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DiscoveryTriageDecision"
ADD CONSTRAINT "DiscoveryTriageDecision_qualityIssueId_fkey"
FOREIGN KEY ("qualityIssueId") REFERENCES "PortfolioQualityIssue"("id")
ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DiscoveryTriageDecision"
ADD CONSTRAINT "DiscoveryTriageDecision_selectedTaxonomyNodeId_fkey"
FOREIGN KEY ("selectedTaxonomyNodeId") REFERENCES "TaxonomyNode"("id")
ON DELETE SET NULL ON UPDATE CASCADE;

-- Normalize the attribution method spelling introduced before the hyphenated enum rule.
UPDATE "InventoryEntity"
SET "attributionMethod" = 'ai-proposed'
WHERE "attributionMethod" = 'ai_proposed';
