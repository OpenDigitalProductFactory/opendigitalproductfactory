-- CreateTable
CREATE TABLE "IntegrationImportBatch" (
    "id" TEXT NOT NULL,
    "batchRef" TEXT NOT NULL,
    "sourceProvider" TEXT NOT NULL,
    "providerEnvironment" TEXT,
    "sourceTimestamp" TIMESTAMP(3),
    "status" TEXT NOT NULL DEFAULT 'reviewing',
    "createdById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "IntegrationImportBatch_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "IntegrationImportStagedRecord" (
    "id" TEXT NOT NULL,
    "importBatchId" TEXT NOT NULL,
    "sourceProvider" TEXT NOT NULL,
    "entityFamily" TEXT NOT NULL,
    "externalId" TEXT NOT NULL,
    "sourceTimestamp" TIMESTAMP(3),
    "ownerSide" TEXT NOT NULL,
    "reviewStatus" TEXT NOT NULL DEFAULT 'candidate',
    "proposedLocalEntityType" TEXT NOT NULL,
    "proposedLocalId" TEXT,
    "proposedLocalStatus" TEXT NOT NULL DEFAULT 'candidate',
    "proposedLocalConfidence" TEXT NOT NULL DEFAULT 'low',
    "proposedLocalReason" TEXT NOT NULL,
    "displayFields" JSONB NOT NULL,
    "sourceFingerprint" TEXT NOT NULL,
    "readOnly" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "IntegrationImportStagedRecord_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "IntegrationImportBatch_batchRef_key" ON "IntegrationImportBatch"("batchRef");

-- CreateIndex
CREATE INDEX "IntegrationImportBatch_sourceProvider_status_idx" ON "IntegrationImportBatch"("sourceProvider", "status");

-- CreateIndex
CREATE INDEX "IntegrationImportBatch_createdAt_idx" ON "IntegrationImportBatch"("createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "integration_import_record_batch_family_external_key" ON "IntegrationImportStagedRecord"("importBatchId", "entityFamily", "externalId");

-- CreateIndex
CREATE INDEX "integration_import_record_source_family_external_idx" ON "IntegrationImportStagedRecord"("sourceProvider", "entityFamily", "externalId");

-- CreateIndex
CREATE INDEX "IntegrationImportStagedRecord_reviewStatus_idx" ON "IntegrationImportStagedRecord"("reviewStatus");

-- AddForeignKey
ALTER TABLE "IntegrationImportStagedRecord" ADD CONSTRAINT "IntegrationImportStagedRecord_importBatchId_fkey" FOREIGN KEY ("importBatchId") REFERENCES "IntegrationImportBatch"("id") ON DELETE CASCADE ON UPDATE CASCADE;
