-- CreateTable: DiscoveryRun
CREATE TABLE "DiscoveryRun" (
    "id" TEXT NOT NULL,
    "runKey" TEXT NOT NULL,
    "sourceSlug" TEXT NOT NULL,
    "trigger" TEXT NOT NULL DEFAULT 'bootstrap',
    "status" TEXT NOT NULL DEFAULT 'running',
    "startedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "completedAt" TIMESTAMP(3),
    "itemCount" INTEGER NOT NULL DEFAULT 0,
    "relationshipCount" INTEGER NOT NULL DEFAULT 0,
    "notes" JSONB,

    CONSTRAINT "DiscoveryRun_pkey" PRIMARY KEY ("id")
);

-- CreateTable: InventoryEntity
CREATE TABLE "InventoryEntity" (
    "id" TEXT NOT NULL,
    "entityKey" TEXT NOT NULL,
    "entityType" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'active',
    "attributionStatus" TEXT NOT NULL DEFAULT 'needs_review',
    "confidence" DOUBLE PRECISION,
    "providerView" TEXT NOT NULL DEFAULT 'foundational',
    "properties" JSONB NOT NULL DEFAULT '{}',
    "firstSeenAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastSeenAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastConfirmedRunId" TEXT,
    "portfolioId" TEXT,
    "taxonomyNodeId" TEXT,
    "digitalProductId" TEXT,

    CONSTRAINT "InventoryEntity_pkey" PRIMARY KEY ("id")
);

-- CreateTable: InventoryRelationship
CREATE TABLE "InventoryRelationship" (
    "id" TEXT NOT NULL,
    "relationshipKey" TEXT NOT NULL,
    "relationshipType" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'active',
    "confidence" DOUBLE PRECISION,
    "properties" JSONB,
    "firstSeenAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastSeenAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastConfirmedRunId" TEXT,
    "fromEntityId" TEXT NOT NULL,
    "toEntityId" TEXT NOT NULL,

    CONSTRAINT "InventoryRelationship_pkey" PRIMARY KEY ("id")
);

-- CreateTable: DiscoveredItem
CREATE TABLE "DiscoveredItem" (
    "id" TEXT NOT NULL,
    "discoveryRunId" TEXT NOT NULL,
    "observedKey" TEXT NOT NULL,
    "itemType" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "sourcePath" TEXT,
    "confidence" DOUBLE PRECISION,
    "attributionStatus" TEXT NOT NULL DEFAULT 'unmapped',
    "rawData" JSONB NOT NULL,
    "firstSeenAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastSeenAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "inventoryEntityId" TEXT,

    CONSTRAINT "DiscoveredItem_pkey" PRIMARY KEY ("id")
);

-- CreateTable: DiscoveredRelationship
CREATE TABLE "DiscoveredRelationship" (
    "id" TEXT NOT NULL,
    "discoveryRunId" TEXT NOT NULL,
    "relationshipKey" TEXT NOT NULL,
    "relationshipType" TEXT NOT NULL,
    "fromDiscoveredItemId" TEXT NOT NULL,
    "toDiscoveredItemId" TEXT NOT NULL,
    "confidence" DOUBLE PRECISION,
    "rawData" JSONB,
    "inventoryRelationshipId" TEXT,

    CONSTRAINT "DiscoveredRelationship_pkey" PRIMARY KEY ("id")
);

-- CreateTable: PortfolioQualityIssue
CREATE TABLE "PortfolioQualityIssue" (
    "id" TEXT NOT NULL,
    "issueKey" TEXT NOT NULL,
    "issueType" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'open',
    "severity" TEXT NOT NULL DEFAULT 'warn',
    "summary" TEXT NOT NULL,
    "details" JSONB,
    "firstDetectedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastDetectedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "resolvedAt" TIMESTAMP(3),
    "inventoryEntityId" TEXT,
    "inventoryRelationshipId" TEXT,
    "portfolioId" TEXT,
    "taxonomyNodeId" TEXT,
    "digitalProductId" TEXT,

    CONSTRAINT "PortfolioQualityIssue_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "DiscoveryRun_runKey_key" ON "DiscoveryRun"("runKey");

-- CreateIndex
CREATE UNIQUE INDEX "InventoryEntity_entityKey_key" ON "InventoryEntity"("entityKey");

-- CreateIndex
CREATE INDEX "InventoryEntity_entityType_idx" ON "InventoryEntity"("entityType");
CREATE INDEX "InventoryEntity_attributionStatus_idx" ON "InventoryEntity"("attributionStatus");
CREATE INDEX "InventoryEntity_portfolioId_idx" ON "InventoryEntity"("portfolioId");
CREATE INDEX "InventoryEntity_taxonomyNodeId_idx" ON "InventoryEntity"("taxonomyNodeId");
CREATE INDEX "InventoryEntity_digitalProductId_idx" ON "InventoryEntity"("digitalProductId");

-- CreateIndex
CREATE UNIQUE INDEX "InventoryRelationship_relationshipKey_key" ON "InventoryRelationship"("relationshipKey");
CREATE UNIQUE INDEX "InventoryRelationship_fromEntityId_toEntityId_relationshipType_key"
ON "InventoryRelationship"("fromEntityId", "toEntityId", "relationshipType");
CREATE INDEX "InventoryRelationship_relationshipType_idx" ON "InventoryRelationship"("relationshipType");
CREATE INDEX "InventoryRelationship_status_idx" ON "InventoryRelationship"("status");

-- CreateIndex
CREATE UNIQUE INDEX "DiscoveredItem_discoveryRunId_observedKey_key"
ON "DiscoveredItem"("discoveryRunId", "observedKey");
CREATE INDEX "DiscoveredItem_itemType_idx" ON "DiscoveredItem"("itemType");
CREATE INDEX "DiscoveredItem_attributionStatus_idx" ON "DiscoveredItem"("attributionStatus");

-- CreateIndex
CREATE UNIQUE INDEX "DiscoveredRelationship_discoveryRunId_relationshipKey_key"
ON "DiscoveredRelationship"("discoveryRunId", "relationshipKey");
CREATE INDEX "DiscoveredRelationship_relationshipType_idx" ON "DiscoveredRelationship"("relationshipType");

-- CreateIndex
CREATE UNIQUE INDEX "PortfolioQualityIssue_issueKey_key" ON "PortfolioQualityIssue"("issueKey");
CREATE INDEX "PortfolioQualityIssue_issueType_idx" ON "PortfolioQualityIssue"("issueType");
CREATE INDEX "PortfolioQualityIssue_status_idx" ON "PortfolioQualityIssue"("status");
CREATE INDEX "PortfolioQualityIssue_severity_idx" ON "PortfolioQualityIssue"("severity");
CREATE INDEX "PortfolioQualityIssue_portfolioId_idx" ON "PortfolioQualityIssue"("portfolioId");
CREATE INDEX "PortfolioQualityIssue_taxonomyNodeId_idx" ON "PortfolioQualityIssue"("taxonomyNodeId");
CREATE INDEX "PortfolioQualityIssue_digitalProductId_idx" ON "PortfolioQualityIssue"("digitalProductId");

-- AddForeignKey
ALTER TABLE "InventoryEntity"
ADD CONSTRAINT "InventoryEntity_lastConfirmedRunId_fkey"
FOREIGN KEY ("lastConfirmedRunId") REFERENCES "DiscoveryRun"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "InventoryEntity"
ADD CONSTRAINT "InventoryEntity_portfolioId_fkey"
FOREIGN KEY ("portfolioId") REFERENCES "Portfolio"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "InventoryEntity"
ADD CONSTRAINT "InventoryEntity_taxonomyNodeId_fkey"
FOREIGN KEY ("taxonomyNodeId") REFERENCES "TaxonomyNode"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "InventoryEntity"
ADD CONSTRAINT "InventoryEntity_digitalProductId_fkey"
FOREIGN KEY ("digitalProductId") REFERENCES "DigitalProduct"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "InventoryRelationship"
ADD CONSTRAINT "InventoryRelationship_lastConfirmedRunId_fkey"
FOREIGN KEY ("lastConfirmedRunId") REFERENCES "DiscoveryRun"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "InventoryRelationship"
ADD CONSTRAINT "InventoryRelationship_fromEntityId_fkey"
FOREIGN KEY ("fromEntityId") REFERENCES "InventoryEntity"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "InventoryRelationship"
ADD CONSTRAINT "InventoryRelationship_toEntityId_fkey"
FOREIGN KEY ("toEntityId") REFERENCES "InventoryEntity"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "DiscoveredItem"
ADD CONSTRAINT "DiscoveredItem_discoveryRunId_fkey"
FOREIGN KEY ("discoveryRunId") REFERENCES "DiscoveryRun"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "DiscoveredItem"
ADD CONSTRAINT "DiscoveredItem_inventoryEntityId_fkey"
FOREIGN KEY ("inventoryEntityId") REFERENCES "InventoryEntity"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "DiscoveredRelationship"
ADD CONSTRAINT "DiscoveredRelationship_discoveryRunId_fkey"
FOREIGN KEY ("discoveryRunId") REFERENCES "DiscoveryRun"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "DiscoveredRelationship"
ADD CONSTRAINT "DiscoveredRelationship_fromDiscoveredItemId_fkey"
FOREIGN KEY ("fromDiscoveredItemId") REFERENCES "DiscoveredItem"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "DiscoveredRelationship"
ADD CONSTRAINT "DiscoveredRelationship_toDiscoveredItemId_fkey"
FOREIGN KEY ("toDiscoveredItemId") REFERENCES "DiscoveredItem"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "DiscoveredRelationship"
ADD CONSTRAINT "DiscoveredRelationship_inventoryRelationshipId_fkey"
FOREIGN KEY ("inventoryRelationshipId") REFERENCES "InventoryRelationship"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "PortfolioQualityIssue"
ADD CONSTRAINT "PortfolioQualityIssue_inventoryEntityId_fkey"
FOREIGN KEY ("inventoryEntityId") REFERENCES "InventoryEntity"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "PortfolioQualityIssue"
ADD CONSTRAINT "PortfolioQualityIssue_inventoryRelationshipId_fkey"
FOREIGN KEY ("inventoryRelationshipId") REFERENCES "InventoryRelationship"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "PortfolioQualityIssue"
ADD CONSTRAINT "PortfolioQualityIssue_portfolioId_fkey"
FOREIGN KEY ("portfolioId") REFERENCES "Portfolio"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "PortfolioQualityIssue"
ADD CONSTRAINT "PortfolioQualityIssue_taxonomyNodeId_fkey"
FOREIGN KEY ("taxonomyNodeId") REFERENCES "TaxonomyNode"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "PortfolioQualityIssue"
ADD CONSTRAINT "PortfolioQualityIssue_digitalProductId_fkey"
FOREIGN KEY ("digitalProductId") REFERENCES "DigitalProduct"("id") ON DELETE SET NULL ON UPDATE CASCADE;
