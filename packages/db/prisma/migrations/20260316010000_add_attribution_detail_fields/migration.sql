-- AlterTable
ALTER TABLE "InventoryEntity" ADD COLUMN IF NOT EXISTS "attributionMethod" TEXT;
ALTER TABLE "InventoryEntity" ADD COLUMN IF NOT EXISTS "attributionConfidence" DOUBLE PRECISION;
ALTER TABLE "InventoryEntity" ADD COLUMN IF NOT EXISTS "attributionEvidence" JSONB;
ALTER TABLE "InventoryEntity" ADD COLUMN IF NOT EXISTS "candidateTaxonomy" JSONB;
