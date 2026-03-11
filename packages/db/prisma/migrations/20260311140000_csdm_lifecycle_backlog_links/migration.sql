-- AlterTable: replace status with CSDM two-attribute lifecycle on DigitalProduct
ALTER TABLE "DigitalProduct" DROP COLUMN "status";
ALTER TABLE "DigitalProduct" ADD COLUMN     "lifecycleStage" TEXT NOT NULL DEFAULT 'plan';
ALTER TABLE "DigitalProduct" ADD COLUMN     "lifecycleStatus" TEXT NOT NULL DEFAULT 'draft';

-- AlterTable: add priority and FK columns to BacklogItem
ALTER TABLE "BacklogItem" ADD COLUMN     "priority" INTEGER;
ALTER TABLE "BacklogItem" ADD COLUMN     "digitalProductId" TEXT;
ALTER TABLE "BacklogItem" ADD COLUMN     "taxonomyNodeId" TEXT;

-- AddForeignKey
ALTER TABLE "BacklogItem" ADD CONSTRAINT "BacklogItem_digitalProductId_fkey" FOREIGN KEY ("digitalProductId") REFERENCES "DigitalProduct"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BacklogItem" ADD CONSTRAINT "BacklogItem_taxonomyNodeId_fkey" FOREIGN KEY ("taxonomyNodeId") REFERENCES "TaxonomyNode"("id") ON DELETE SET NULL ON UPDATE CASCADE;
