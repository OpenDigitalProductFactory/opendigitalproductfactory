-- EP-ASSET-INTELLIGENCE / BI-74579817: canonical identity + support-lifecycle spine
-- for discovery enrichment. Additive only — new tables land empty; new columns are
-- nullable (or have a default) so existing rows are unaffected.
-- @migration-safety: data-safe: all new tables are empty on creation; every added
-- column is nullable or carries a default, so no existing row is invalidated and no
-- constraint can fail on current data. The pre-existing dangling
-- DiscoveredSoftwareEvidence.softwareIdentityId column is intentionally left untouched.

-- CreateTable
CREATE TABLE "CatalogIdentity" (
    "id" TEXT NOT NULL,
    "identityKey" TEXT NOT NULL,
    "part" TEXT NOT NULL DEFAULT 'a',
    "manufacturer" TEXT NOT NULL,
    "product" TEXT NOT NULL,
    "productVersion" TEXT,
    "edition" TEXT,
    "patchLevel" TEXT,
    "cpe" TEXT,
    "category" TEXT,
    "source" TEXT NOT NULL DEFAULT 'manual',
    "confidence" DOUBLE PRECISION,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "CatalogIdentity_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CatalogLifecycleMilestone" (
    "id" TEXT NOT NULL,
    "catalogIdentityId" TEXT NOT NULL,
    "milestone" TEXT NOT NULL,
    "date" TIMESTAMP(3),
    "source" TEXT NOT NULL,
    "confidence" DOUBLE PRECISION,
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "CatalogLifecycleMilestone_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "IdentityResolutionLog" (
    "id" TEXT NOT NULL,
    "inventoryEntityId" TEXT,
    "catalogIdentityId" TEXT,
    "fingerprintRuleId" TEXT,
    "resolutionType" TEXT NOT NULL,
    "confidence" DOUBLE PRECISION,
    "evidence" JSONB,
    "discoveryRunId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "IdentityResolutionLog_pkey" PRIMARY KEY ("id")
);

-- AlterTable
ALTER TABLE "DiscoveredSoftwareEvidence" ADD COLUMN     "catalogIdentityId" TEXT;

-- AlterTable
ALTER TABLE "DigitalProduct" ADD COLUMN     "enrichmentStatus" TEXT DEFAULT 'pending',
ADD COLUMN     "lastEnrichedAt" TIMESTAMP(3);

-- AlterTable
ALTER TABLE "DiscoveryFingerprintRule" ADD COLUMN     "catalogIdentityId" TEXT;

-- AlterTable
ALTER TABLE "InventoryEntity" ADD COLUMN     "catalogIdentityId" TEXT,
ADD COLUMN     "identityConfidence" DOUBLE PRECISION,
ADD COLUMN     "identityStatus" TEXT,
ADD COLUMN     "latestKnownVersion" TEXT,
ADD COLUMN     "supportLifecycleConfidence" DOUBLE PRECISION,
ADD COLUMN     "supportLifecycleSource" TEXT,
ADD COLUMN     "updatePosture" TEXT NOT NULL DEFAULT 'unknown',
ADD COLUMN     "updatePostureConfidence" DOUBLE PRECISION,
ADD COLUMN     "updatePostureSource" TEXT;

-- CreateIndex
CREATE UNIQUE INDEX "CatalogIdentity_identityKey_key" ON "CatalogIdentity"("identityKey");

-- CreateIndex
CREATE INDEX "CatalogIdentity_manufacturer_product_idx" ON "CatalogIdentity"("manufacturer", "product");

-- CreateIndex
CREATE INDEX "CatalogIdentity_cpe_idx" ON "CatalogIdentity"("cpe");

-- CreateIndex
CREATE INDEX "CatalogIdentity_part_idx" ON "CatalogIdentity"("part");

-- CreateIndex
CREATE UNIQUE INDEX "CatalogLifecycleMilestone_identity_milestone_source_key" ON "CatalogLifecycleMilestone"("catalogIdentityId", "milestone", "source");

-- CreateIndex
CREATE INDEX "CatalogLifecycleMilestone_catalogIdentityId_idx" ON "CatalogLifecycleMilestone"("catalogIdentityId");

-- CreateIndex
CREATE INDEX "CatalogLifecycleMilestone_milestone_idx" ON "CatalogLifecycleMilestone"("milestone");

-- CreateIndex
CREATE INDEX "IdentityResolutionLog_inventoryEntityId_idx" ON "IdentityResolutionLog"("inventoryEntityId");

-- CreateIndex
CREATE INDEX "IdentityResolutionLog_catalogIdentityId_idx" ON "IdentityResolutionLog"("catalogIdentityId");

-- CreateIndex
CREATE INDEX "IdentityResolutionLog_resolutionType_idx" ON "IdentityResolutionLog"("resolutionType");

-- CreateIndex
CREATE INDEX "DiscoveredSoftwareEvidence_catalogIdentityId_idx" ON "DiscoveredSoftwareEvidence"("catalogIdentityId");

-- CreateIndex
CREATE INDEX "DiscoveryFingerprintRule_catalogIdentityId_idx" ON "DiscoveryFingerprintRule"("catalogIdentityId");

-- CreateIndex
CREATE INDEX "InventoryEntity_catalogIdentityId_idx" ON "InventoryEntity"("catalogIdentityId");

-- AddForeignKey
ALTER TABLE "CatalogLifecycleMilestone" ADD CONSTRAINT "CatalogLifecycleMilestone_catalogIdentityId_fkey" FOREIGN KEY ("catalogIdentityId") REFERENCES "CatalogIdentity"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "IdentityResolutionLog" ADD CONSTRAINT "IdentityResolutionLog_inventoryEntityId_fkey" FOREIGN KEY ("inventoryEntityId") REFERENCES "InventoryEntity"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "IdentityResolutionLog" ADD CONSTRAINT "IdentityResolutionLog_catalogIdentityId_fkey" FOREIGN KEY ("catalogIdentityId") REFERENCES "CatalogIdentity"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "IdentityResolutionLog" ADD CONSTRAINT "IdentityResolutionLog_fingerprintRuleId_fkey" FOREIGN KEY ("fingerprintRuleId") REFERENCES "DiscoveryFingerprintRule"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DiscoveredSoftwareEvidence" ADD CONSTRAINT "DiscoveredSoftwareEvidence_catalogIdentityId_fkey" FOREIGN KEY ("catalogIdentityId") REFERENCES "CatalogIdentity"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DiscoveryFingerprintRule" ADD CONSTRAINT "DiscoveryFingerprintRule_catalogIdentityId_fkey" FOREIGN KEY ("catalogIdentityId") REFERENCES "CatalogIdentity"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "InventoryEntity" ADD CONSTRAINT "InventoryEntity_catalogIdentityId_fkey" FOREIGN KEY ("catalogIdentityId") REFERENCES "CatalogIdentity"("id") ON DELETE SET NULL ON UPDATE CASCADE;
