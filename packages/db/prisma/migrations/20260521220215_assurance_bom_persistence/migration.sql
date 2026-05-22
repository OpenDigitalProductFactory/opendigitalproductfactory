-- CreateTable
CREATE TABLE "AssuranceRun" (
    "id" TEXT NOT NULL,
    "runId" TEXT NOT NULL,
    "scopeType" TEXT NOT NULL,
    "scopeId" TEXT NOT NULL,
    "policyKey" TEXT,
    "adapterKey" TEXT NOT NULL,
    "adapterVersion" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'running',
    "summary" JSONB NOT NULL DEFAULT '{}',
    "startedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "completedAt" TIMESTAMP(3),
    "buildId" TEXT,
    "digitalProductId" TEXT,
    "releaseBundleId" TEXT,
    "toolExecutionId" TEXT,
    "toolExecutionReceiptId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "AssuranceRun_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "BomDocument" (
    "id" TEXT NOT NULL,
    "documentId" TEXT NOT NULL,
    "format" TEXT NOT NULL,
    "formatVersion" TEXT NOT NULL,
    "serialNumber" TEXT,
    "version" INTEGER NOT NULL,
    "digest" TEXT NOT NULL,
    "sourceKind" TEXT NOT NULL,
    "sourceDigest" TEXT NOT NULL,
    "componentCount" INTEGER NOT NULL,
    "raw" JSONB NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'current',
    "generatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "buildId" TEXT,
    "digitalProductId" TEXT,
    "assuranceRunId" TEXT,
    "artifactRevisionId" TEXT,

    CONSTRAINT "BomDocument_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "BomComponent" (
    "id" TEXT NOT NULL,
    "componentKey" TEXT NOT NULL,
    "componentType" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "version" TEXT,
    "packageUrl" TEXT,
    "supplierName" TEXT,
    "licenseExpression" TEXT,
    "ecosystem" TEXT,
    "scope" TEXT,
    "metadata" JSONB NOT NULL DEFAULT '{}',
    "firstSeenAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastSeenAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "BomComponent_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "BomComponentOccurrence" (
    "id" TEXT NOT NULL,
    "occurrenceKey" TEXT NOT NULL,
    "bomDocumentId" TEXT NOT NULL,
    "componentId" TEXT NOT NULL,
    "workspaceName" TEXT,
    "workspacePath" TEXT,
    "dependencyKind" TEXT,
    "direct" BOOLEAN NOT NULL DEFAULT false,
    "evidence" JSONB NOT NULL DEFAULT '{}',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "BomComponentOccurrence_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "AssuranceRun_runId_key" ON "AssuranceRun"("runId");

-- CreateIndex
CREATE UNIQUE INDEX "AssuranceRun_toolExecutionId_key" ON "AssuranceRun"("toolExecutionId");

-- CreateIndex
CREATE UNIQUE INDEX "AssuranceRun_toolExecutionReceiptId_key" ON "AssuranceRun"("toolExecutionReceiptId");

-- CreateIndex
CREATE INDEX "AssuranceRun_scopeType_scopeId_startedAt_idx" ON "AssuranceRun"("scopeType", "scopeId", "startedAt" DESC);

-- CreateIndex
CREATE INDEX "AssuranceRun_buildId_startedAt_idx" ON "AssuranceRun"("buildId", "startedAt" DESC);

-- CreateIndex
CREATE INDEX "AssuranceRun_digitalProductId_startedAt_idx" ON "AssuranceRun"("digitalProductId", "startedAt" DESC);

-- CreateIndex
CREATE INDEX "AssuranceRun_adapterKey_status_idx" ON "AssuranceRun"("adapterKey", "status");

-- CreateIndex
CREATE UNIQUE INDEX "BomDocument_documentId_key" ON "BomDocument"("documentId");

-- CreateIndex
CREATE INDEX "BomDocument_buildId_generatedAt_idx" ON "BomDocument"("buildId", "generatedAt" DESC);

-- CreateIndex
CREATE INDEX "BomDocument_digitalProductId_generatedAt_idx" ON "BomDocument"("digitalProductId", "generatedAt" DESC);

-- CreateIndex
CREATE INDEX "BomDocument_digest_idx" ON "BomDocument"("digest");

-- CreateIndex
CREATE INDEX "BomDocument_status_idx" ON "BomDocument"("status");

-- CreateIndex
CREATE UNIQUE INDEX "BomComponent_componentKey_key" ON "BomComponent"("componentKey");

-- CreateIndex
CREATE INDEX "BomComponent_componentType_name_idx" ON "BomComponent"("componentType", "name");

-- CreateIndex
CREATE INDEX "BomComponent_packageUrl_idx" ON "BomComponent"("packageUrl");

-- CreateIndex
CREATE INDEX "BomComponent_ecosystem_idx" ON "BomComponent"("ecosystem");

-- CreateIndex
CREATE UNIQUE INDEX "BomComponentOccurrence_occurrenceKey_key" ON "BomComponentOccurrence"("occurrenceKey");

-- CreateIndex
CREATE INDEX "BomComponentOccurrence_bomDocumentId_idx" ON "BomComponentOccurrence"("bomDocumentId");

-- CreateIndex
CREATE INDEX "BomComponentOccurrence_componentId_idx" ON "BomComponentOccurrence"("componentId");

-- CreateIndex
CREATE INDEX "BomComponentOccurrence_workspacePath_idx" ON "BomComponentOccurrence"("workspacePath");

-- CreateIndex
CREATE INDEX "BomComponentOccurrence_dependencyKind_idx" ON "BomComponentOccurrence"("dependencyKind");

-- AddForeignKey
ALTER TABLE "AssuranceRun" ADD CONSTRAINT "AssuranceRun_buildId_fkey" FOREIGN KEY ("buildId") REFERENCES "FeatureBuild"("buildId") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AssuranceRun" ADD CONSTRAINT "AssuranceRun_digitalProductId_fkey" FOREIGN KEY ("digitalProductId") REFERENCES "DigitalProduct"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AssuranceRun" ADD CONSTRAINT "AssuranceRun_releaseBundleId_fkey" FOREIGN KEY ("releaseBundleId") REFERENCES "ReleaseBundle"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AssuranceRun" ADD CONSTRAINT "AssuranceRun_toolExecutionId_fkey" FOREIGN KEY ("toolExecutionId") REFERENCES "ToolExecution"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AssuranceRun" ADD CONSTRAINT "AssuranceRun_toolExecutionReceiptId_fkey" FOREIGN KEY ("toolExecutionReceiptId") REFERENCES "ToolExecutionReceipt"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BomDocument" ADD CONSTRAINT "BomDocument_buildId_fkey" FOREIGN KEY ("buildId") REFERENCES "FeatureBuild"("buildId") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BomDocument" ADD CONSTRAINT "BomDocument_digitalProductId_fkey" FOREIGN KEY ("digitalProductId") REFERENCES "DigitalProduct"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BomDocument" ADD CONSTRAINT "BomDocument_assuranceRunId_fkey" FOREIGN KEY ("assuranceRunId") REFERENCES "AssuranceRun"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BomDocument" ADD CONSTRAINT "BomDocument_artifactRevisionId_fkey" FOREIGN KEY ("artifactRevisionId") REFERENCES "BuildArtifactRevision"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BomComponentOccurrence" ADD CONSTRAINT "BomComponentOccurrence_bomDocumentId_fkey" FOREIGN KEY ("bomDocumentId") REFERENCES "BomDocument"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BomComponentOccurrence" ADD CONSTRAINT "BomComponentOccurrence_componentId_fkey" FOREIGN KEY ("componentId") REFERENCES "BomComponent"("id") ON DELETE CASCADE ON UPDATE CASCADE;
