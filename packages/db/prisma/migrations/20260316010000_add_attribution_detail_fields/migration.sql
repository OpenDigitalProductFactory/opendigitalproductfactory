-- AlterTable
ALTER TABLE "InventoryEntity" ADD COLUMN "attributionMethod" TEXT;
ALTER TABLE "InventoryEntity" ADD COLUMN "attributionConfidence" DOUBLE PRECISION;
ALTER TABLE "InventoryEntity" ADD COLUMN "attributionEvidence" JSONB;
ALTER TABLE "InventoryEntity" ADD COLUMN "candidateTaxonomy" JSONB;
