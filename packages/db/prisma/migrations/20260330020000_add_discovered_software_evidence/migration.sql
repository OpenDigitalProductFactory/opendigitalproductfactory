-- CreateTable
CREATE TABLE "DiscoveredSoftwareEvidence" (
    "id" TEXT NOT NULL,
    "evidenceKey" TEXT NOT NULL,
    "inventoryEntityId" TEXT NOT NULL,
    "evidenceSource" TEXT NOT NULL,
    "packageManager" TEXT,
    "rawVendor" TEXT,
    "rawProductName" TEXT,
    "rawPackageName" TEXT,
    "rawVersion" TEXT,
    "installLocation" TEXT,
    "rawMetadata" JSONB,
    "normalizationStatus" TEXT NOT NULL DEFAULT 'pending',
    "normalizationConfidence" DOUBLE PRECISION,
    "softwareIdentityId" TEXT,
    "firstSeenAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastSeenAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "DiscoveredSoftwareEvidence_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "DiscoveredSoftwareEvidence_evidenceKey_key" ON "DiscoveredSoftwareEvidence"("evidenceKey");

-- CreateIndex
CREATE INDEX "DiscoveredSoftwareEvidence_inventoryEntityId_idx" ON "DiscoveredSoftwareEvidence"("inventoryEntityId");

-- CreateIndex
CREATE INDEX "DiscoveredSoftwareEvidence_normalizationStatus_idx" ON "DiscoveredSoftwareEvidence"("normalizationStatus");

-- AddForeignKey
ALTER TABLE "DiscoveredSoftwareEvidence" ADD CONSTRAINT "DiscoveredSoftwareEvidence_inventoryEntityId_fkey" FOREIGN KEY ("inventoryEntityId") REFERENCES "InventoryEntity"("id") ON DELETE CASCADE ON UPDATE CASCADE;
