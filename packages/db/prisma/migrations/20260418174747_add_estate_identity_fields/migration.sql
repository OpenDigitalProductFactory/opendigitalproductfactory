-- AlterTable
ALTER TABLE "InventoryEntity" ADD COLUMN     "iconKey" TEXT,
ADD COLUMN     "manufacturer" TEXT,
ADD COLUMN     "normalizedVersion" TEXT,
ADD COLUMN     "observedVersion" TEXT,
ADD COLUMN     "productModel" TEXT,
ADD COLUMN     "supportStatus" TEXT NOT NULL DEFAULT 'unknown',
ADD COLUMN     "technicalClass" TEXT;

WITH ranked_evidence AS (
  SELECT
    dse."inventoryEntityId",
    dse."rawVendor",
    dse."rawProductName",
    dse."rawPackageName",
    dse."rawVersion",
    ROW_NUMBER() OVER (
      PARTITION BY dse."inventoryEntityId"
      ORDER BY dse."lastSeenAt" DESC, dse."firstSeenAt" DESC, dse."id" DESC
    ) AS row_num
  FROM "DiscoveredSoftwareEvidence" dse
)
UPDATE "InventoryEntity" ie
SET
  "technicalClass" = COALESCE(ie."technicalClass", ie."entityType"),
  "iconKey" = COALESCE(ie."iconKey", ie."entityType"),
  "manufacturer" = COALESCE(ie."manufacturer", re."rawVendor"),
  "productModel" = COALESCE(ie."productModel", re."rawProductName", re."rawPackageName"),
  "observedVersion" = COALESCE(ie."observedVersion", re."rawVersion"),
  "normalizedVersion" = COALESCE(ie."normalizedVersion", re."rawVersion")
FROM ranked_evidence re
WHERE re.row_num = 1
  AND re."inventoryEntityId" = ie."id";

UPDATE "InventoryEntity"
SET
  "technicalClass" = COALESCE("technicalClass", "entityType"),
  "iconKey" = COALESCE("iconKey", "entityType")
WHERE "technicalClass" IS NULL
   OR "iconKey" IS NULL;
