/*
  Warnings:

  - Added the required column `updatedAt` to the `EaRelationship` table without a default value. This is not possible if the table is not empty.

*/
-- AlterTable
ALTER TABLE "EaRelationship" ADD COLUMN     "updatedAt" TIMESTAMP(3) NOT NULL;

-- CreateIndex
CREATE INDEX "EaElement_portfolioId_idx" ON "EaElement"("portfolioId");

-- CreateIndex
CREATE INDEX "EaElement_taxonomyNodeId_idx" ON "EaElement"("taxonomyNodeId");

-- CreateIndex
CREATE INDEX "EaElement_digitalProductId_idx" ON "EaElement"("digitalProductId");

-- CreateIndex
CREATE INDEX "EaElement_elementTypeId_idx" ON "EaElement"("elementTypeId");

-- CreateIndex
CREATE INDEX "EaRelationship_fromElementId_idx" ON "EaRelationship"("fromElementId");

-- CreateIndex
CREATE INDEX "EaRelationship_toElementId_idx" ON "EaRelationship"("toElementId");

-- CreateIndex
CREATE INDEX "EaRelationship_relationshipTypeId_idx" ON "EaRelationship"("relationshipTypeId");

-- CreateIndex
CREATE INDEX "EaViewElement_elementId_idx" ON "EaViewElement"("elementId");
