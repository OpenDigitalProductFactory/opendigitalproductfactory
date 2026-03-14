-- AlterTable
ALTER TABLE "EaViewElement" ADD COLUMN     "orderIndex" INTEGER,
ADD COLUMN     "parentViewElementId" TEXT;

-- CreateTable
CREATE TABLE "EaStructureRule" (
    "id" TEXT NOT NULL,
    "notationId" TEXT NOT NULL,
    "parentElementTypeId" TEXT NOT NULL,
    "childElementTypeId" TEXT NOT NULL,
    "patternSlug" TEXT NOT NULL,
    "minChildren" INTEGER,
    "maxChildren" INTEGER,
    "orderedChildren" BOOLEAN NOT NULL DEFAULT false,
    "impliedRelationshipSlug" TEXT,
    "defaultSeverity" TEXT NOT NULL DEFAULT 'warn',
    "rendererHint" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "EaStructureRule_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "EaConformanceIssue" (
    "id" TEXT NOT NULL,
    "viewId" TEXT,
    "elementId" TEXT,
    "issueType" TEXT NOT NULL,
    "severity" TEXT NOT NULL DEFAULT 'warn',
    "message" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'open',
    "detailsJson" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "EaConformanceIssue_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "EaStructureRule_notationId_patternSlug_idx" ON "EaStructureRule"("notationId", "patternSlug");

-- CreateIndex
CREATE UNIQUE INDEX "EaStructureRule_notationId_parentElementTypeId_childElement_key" ON "EaStructureRule"("notationId", "parentElementTypeId", "childElementTypeId", "patternSlug");

-- CreateIndex
CREATE INDEX "EaConformanceIssue_viewId_status_idx" ON "EaConformanceIssue"("viewId", "status");

-- CreateIndex
CREATE INDEX "EaConformanceIssue_elementId_status_idx" ON "EaConformanceIssue"("elementId", "status");

-- CreateIndex
CREATE INDEX "EaConformanceIssue_issueType_severity_idx" ON "EaConformanceIssue"("issueType", "severity");

-- CreateIndex
CREATE INDEX "EaViewElement_viewId_parentViewElementId_orderIndex_idx" ON "EaViewElement"("viewId", "parentViewElementId", "orderIndex");

-- AddForeignKey
ALTER TABLE "EaViewElement" ADD CONSTRAINT "EaViewElement_parentViewElementId_fkey" FOREIGN KEY ("parentViewElementId") REFERENCES "EaViewElement"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EaStructureRule" ADD CONSTRAINT "EaStructureRule_notationId_fkey" FOREIGN KEY ("notationId") REFERENCES "EaNotation"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EaStructureRule" ADD CONSTRAINT "EaStructureRule_parentElementTypeId_fkey" FOREIGN KEY ("parentElementTypeId") REFERENCES "EaElementType"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EaStructureRule" ADD CONSTRAINT "EaStructureRule_childElementTypeId_fkey" FOREIGN KEY ("childElementTypeId") REFERENCES "EaElementType"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EaConformanceIssue" ADD CONSTRAINT "EaConformanceIssue_viewId_fkey" FOREIGN KEY ("viewId") REFERENCES "EaView"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EaConformanceIssue" ADD CONSTRAINT "EaConformanceIssue_elementId_fkey" FOREIGN KEY ("elementId") REFERENCES "EaElement"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- RenameIndex
ALTER INDEX "InventoryRelationship_fromEntityId_toEntityId_relationshipType_" RENAME TO "InventoryRelationship_fromEntityId_toEntityId_relationshipT_key";
