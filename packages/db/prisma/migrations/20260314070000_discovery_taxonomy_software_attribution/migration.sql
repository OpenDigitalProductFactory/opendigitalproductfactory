-- AlterTable
ALTER TABLE "InventoryEntity"
ADD COLUMN "attributionMethod" TEXT,
ADD COLUMN "attributionConfidence" DOUBLE PRECISION,
ADD COLUMN "attributionEvidence" JSONB,
ADD COLUMN "candidateTaxonomy" JSONB;

-- CreateTable
CREATE TABLE "DiscoveredSoftwareEvidence" (
    "id" TEXT NOT NULL,
    "inventoryEntityId" TEXT NOT NULL,
    "evidenceKey" TEXT NOT NULL,
    "evidenceSource" TEXT NOT NULL,
    "packageManager" TEXT,
    "rawVendor" TEXT,
    "rawProductName" TEXT,
    "rawPackageName" TEXT,
    "rawVersion" TEXT,
    "installLocation" TEXT,
    "rawMetadata" JSONB,
    "normalizationStatus" TEXT NOT NULL DEFAULT 'needs_review',
    "normalizationConfidence" DOUBLE PRECISION,
    "softwareIdentityId" TEXT,
    "firstSeenAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastSeenAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "DiscoveredSoftwareEvidence_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SoftwareIdentity" (
    "id" TEXT NOT NULL,
    "normalizedVendor" TEXT,
    "normalizedProductName" TEXT NOT NULL,
    "normalizedEdition" TEXT,
    "canonicalVersion" TEXT,
    "aliases" JSONB NOT NULL DEFAULT '[]',
    "metadata" JSONB,

    CONSTRAINT "SoftwareIdentity_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SoftwareNormalizationRule" (
    "id" TEXT NOT NULL,
    "ruleKey" TEXT NOT NULL,
    "matchType" TEXT NOT NULL,
    "rawSignature" TEXT NOT NULL,
    "versionTransform" JSONB,
    "source" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'active',
    "softwareIdentityId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "SoftwareNormalizationRule_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "DiscoveredSoftwareEvidence_evidenceKey_key" ON "DiscoveredSoftwareEvidence"("evidenceKey");
CREATE INDEX "DiscoveredSoftwareEvidence_inventoryEntityId_idx" ON "DiscoveredSoftwareEvidence"("inventoryEntityId");
CREATE INDEX "DiscoveredSoftwareEvidence_softwareIdentityId_idx" ON "DiscoveredSoftwareEvidence"("softwareIdentityId");
CREATE INDEX "DiscoveredSoftwareEvidence_normalizationStatus_idx" ON "DiscoveredSoftwareEvidence"("normalizationStatus");

CREATE UNIQUE INDEX "SoftwareIdentity_normalizedProductName_normalizedEdition_canonicalV_key"
ON "SoftwareIdentity"("normalizedProductName", "normalizedEdition", "canonicalVersion");

CREATE UNIQUE INDEX "SoftwareNormalizationRule_ruleKey_key" ON "SoftwareNormalizationRule"("ruleKey");
CREATE INDEX "SoftwareNormalizationRule_softwareIdentityId_idx" ON "SoftwareNormalizationRule"("softwareIdentityId");
CREATE INDEX "SoftwareNormalizationRule_status_idx" ON "SoftwareNormalizationRule"("status");

-- AddForeignKey
ALTER TABLE "DiscoveredSoftwareEvidence"
ADD CONSTRAINT "DiscoveredSoftwareEvidence_inventoryEntityId_fkey"
FOREIGN KEY ("inventoryEntityId") REFERENCES "InventoryEntity"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "DiscoveredSoftwareEvidence"
ADD CONSTRAINT "DiscoveredSoftwareEvidence_softwareIdentityId_fkey"
FOREIGN KEY ("softwareIdentityId") REFERENCES "SoftwareIdentity"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "SoftwareNormalizationRule"
ADD CONSTRAINT "SoftwareNormalizationRule_softwareIdentityId_fkey"
FOREIGN KEY ("softwareIdentityId") REFERENCES "SoftwareIdentity"("id") ON DELETE CASCADE ON UPDATE CASCADE;
