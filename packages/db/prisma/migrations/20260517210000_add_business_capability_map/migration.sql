-- CreateTable
CREATE TABLE "BusinessCapability" (
    "id" TEXT NOT NULL,
    "capabilityId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "description" TEXT,
    "level" INTEGER NOT NULL,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "status" TEXT NOT NULL DEFAULT 'active',
    "parentId" TEXT,
    "currentMaturity" INTEGER NOT NULL DEFAULT 1,
    "targetMaturity" INTEGER NOT NULL DEFAULT 3,
    "maturityRationale" TEXT,
    "it4itValueStreams" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "BusinessCapability_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "BusinessCapabilityTraceLink" (
    "id" TEXT NOT NULL,
    "capabilityId" TEXT NOT NULL,
    "targetType" TEXT NOT NULL,
    "targetId" TEXT NOT NULL,
    "relationship" TEXT NOT NULL DEFAULT 'supports',
    "note" TEXT,
    "taxonomyNodeId" TEXT,
    "digitalProductId" TEXT,
    "backlogItemId" TEXT,
    "eaElementId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "BusinessCapabilityTraceLink_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "BusinessCapability_capabilityId_key" ON "BusinessCapability"("capabilityId");

-- CreateIndex
CREATE INDEX "BusinessCapability_parentId_sortOrder_idx" ON "BusinessCapability"("parentId", "sortOrder");

-- CreateIndex
CREATE INDEX "BusinessCapability_level_status_idx" ON "BusinessCapability"("level", "status");

-- CreateIndex
CREATE UNIQUE INDEX "BusinessCapability_parentId_slug_key" ON "BusinessCapability"("parentId", "slug");

-- CreateIndex
CREATE INDEX "BusinessCapabilityTraceLink_capabilityId_idx" ON "BusinessCapabilityTraceLink"("capabilityId");

-- CreateIndex
CREATE INDEX "BusinessCapabilityTraceLink_targetType_targetId_idx" ON "BusinessCapabilityTraceLink"("targetType", "targetId");

-- CreateIndex
CREATE INDEX "BusinessCapabilityTraceLink_taxonomyNodeId_idx" ON "BusinessCapabilityTraceLink"("taxonomyNodeId");

-- CreateIndex
CREATE INDEX "BusinessCapabilityTraceLink_digitalProductId_idx" ON "BusinessCapabilityTraceLink"("digitalProductId");

-- CreateIndex
CREATE INDEX "BusinessCapabilityTraceLink_backlogItemId_idx" ON "BusinessCapabilityTraceLink"("backlogItemId");

-- CreateIndex
CREATE INDEX "BusinessCapabilityTraceLink_eaElementId_idx" ON "BusinessCapabilityTraceLink"("eaElementId");

-- CreateIndex
CREATE UNIQUE INDEX "BusinessCapabilityTraceLink_unique_target" ON "BusinessCapabilityTraceLink"("capabilityId", "targetType", "targetId", "relationship");

-- AddCheck
ALTER TABLE "BusinessCapability" ADD CONSTRAINT "BusinessCapability_level_check" CHECK ("level" BETWEEN 1 AND 3);

-- AddCheck
ALTER TABLE "BusinessCapability" ADD CONSTRAINT "BusinessCapability_currentMaturity_check" CHECK ("currentMaturity" BETWEEN 1 AND 5);

-- AddCheck
ALTER TABLE "BusinessCapability" ADD CONSTRAINT "BusinessCapability_targetMaturity_check" CHECK ("targetMaturity" BETWEEN 1 AND 5);

-- AddCheck
ALTER TABLE "BusinessCapabilityTraceLink" ADD CONSTRAINT "BusinessCapabilityTraceLink_targetType_check" CHECK ("targetType" IN ('taxonomy_node', 'digital_product', 'backlog_item', 'ea_element'));

-- AddForeignKey
ALTER TABLE "BusinessCapability" ADD CONSTRAINT "BusinessCapability_parentId_fkey" FOREIGN KEY ("parentId") REFERENCES "BusinessCapability"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BusinessCapabilityTraceLink" ADD CONSTRAINT "BusinessCapabilityTraceLink_capabilityId_fkey" FOREIGN KEY ("capabilityId") REFERENCES "BusinessCapability"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BusinessCapabilityTraceLink" ADD CONSTRAINT "BusinessCapabilityTraceLink_taxonomyNodeId_fkey" FOREIGN KEY ("taxonomyNodeId") REFERENCES "TaxonomyNode"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BusinessCapabilityTraceLink" ADD CONSTRAINT "BusinessCapabilityTraceLink_digitalProductId_fkey" FOREIGN KEY ("digitalProductId") REFERENCES "DigitalProduct"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BusinessCapabilityTraceLink" ADD CONSTRAINT "BusinessCapabilityTraceLink_backlogItemId_fkey" FOREIGN KEY ("backlogItemId") REFERENCES "BacklogItem"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BusinessCapabilityTraceLink" ADD CONSTRAINT "BusinessCapabilityTraceLink_eaElementId_fkey" FOREIGN KEY ("eaElementId") REFERENCES "EaElement"("id") ON DELETE CASCADE ON UPDATE CASCADE;
