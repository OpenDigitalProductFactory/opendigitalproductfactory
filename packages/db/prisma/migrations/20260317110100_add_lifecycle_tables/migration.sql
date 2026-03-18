-- ProductVersion
CREATE TABLE "ProductVersion" (
    "id" TEXT NOT NULL,
    "digitalProductId" TEXT NOT NULL,
    "version" TEXT NOT NULL,
    "gitTag" TEXT NOT NULL,
    "gitCommitHash" TEXT NOT NULL,
    "featureBuildId" TEXT,
    "shippedBy" TEXT NOT NULL,
    "shippedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "manifestId" TEXT,
    "changeCount" INTEGER NOT NULL DEFAULT 0,
    "changeSummary" TEXT,
    CONSTRAINT "ProductVersion_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "ProductVersion_manifestId_key" ON "ProductVersion"("manifestId");
CREATE UNIQUE INDEX "ProductVersion_digitalProductId_version_key" ON "ProductVersion"("digitalProductId", "version");
CREATE INDEX "ProductVersion_gitTag_idx" ON "ProductVersion"("gitTag");

ALTER TABLE "ProductVersion" ADD CONSTRAINT "ProductVersion_digitalProductId_fkey" FOREIGN KEY ("digitalProductId") REFERENCES "DigitalProduct"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "ProductVersion" ADD CONSTRAINT "ProductVersion_featureBuildId_fkey" FOREIGN KEY ("featureBuildId") REFERENCES "FeatureBuild"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- ChangePromotion
CREATE TABLE "ChangePromotion" (
    "id" TEXT NOT NULL,
    "promotionId" TEXT NOT NULL,
    "productVersionId" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'pending',
    "requestedBy" TEXT NOT NULL,
    "approvedBy" TEXT,
    "approvedAt" TIMESTAMP(3),
    "rejectedBy" TEXT,
    "rejectedAt" TIMESTAMP(3),
    "rationale" TEXT,
    "deployedAt" TIMESTAMP(3),
    "deploymentLog" TEXT,
    "rolledBackAt" TIMESTAMP(3),
    "rolledBackBy" TEXT,
    "rollbackReason" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "ChangePromotion_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "ChangePromotion_promotionId_key" ON "ChangePromotion"("promotionId");
CREATE INDEX "ChangePromotion_status_idx" ON "ChangePromotion"("status");
CREATE INDEX "ChangePromotion_productVersionId_idx" ON "ChangePromotion"("productVersionId");

ALTER TABLE "ChangePromotion" ADD CONSTRAINT "ChangePromotion_productVersionId_fkey" FOREIGN KEY ("productVersionId") REFERENCES "ProductVersion"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- CodebaseManifest
CREATE TABLE "CodebaseManifest" (
    "id" TEXT NOT NULL,
    "version" TEXT NOT NULL,
    "gitRef" TEXT NOT NULL,
    "manifest" JSONB NOT NULL,
    "digitalProductId" TEXT,
    "generatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "CodebaseManifest_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "CodebaseManifest_version_digitalProductId_key" ON "CodebaseManifest"("version", "digitalProductId");
CREATE INDEX "CodebaseManifest_digitalProductId_idx" ON "CodebaseManifest"("digitalProductId");

ALTER TABLE "CodebaseManifest" ADD CONSTRAINT "CodebaseManifest_digitalProductId_fkey" FOREIGN KEY ("digitalProductId") REFERENCES "DigitalProduct"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "ProductVersion" ADD CONSTRAINT "ProductVersion_manifestId_fkey" FOREIGN KEY ("manifestId") REFERENCES "CodebaseManifest"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- ServiceOffering
CREATE TABLE "ServiceOffering" (
    "id" TEXT NOT NULL,
    "offeringId" TEXT NOT NULL,
    "digitalProductId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "consumers" JSONB NOT NULL,
    "availabilityTarget" DOUBLE PRECISION,
    "mttrHours" DOUBLE PRECISION,
    "mtbfHours" DOUBLE PRECISION,
    "rtoHours" DOUBLE PRECISION,
    "rpoHours" DOUBLE PRECISION,
    "supportHours" TEXT,
    "claRef" TEXT,
    "olaRef" TEXT,
    "status" TEXT NOT NULL DEFAULT 'draft',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "ServiceOffering_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "ServiceOffering_offeringId_key" ON "ServiceOffering"("offeringId");

ALTER TABLE "ServiceOffering" ADD CONSTRAINT "ServiceOffering_digitalProductId_fkey" FOREIGN KEY ("digitalProductId") REFERENCES "DigitalProduct"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
