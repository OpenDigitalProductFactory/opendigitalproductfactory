-- Artifact provenance receipts slice 1.
--
-- Adds the receipt and immutable artifact revision foundation for Build Studio.
-- Purely additive: no existing columns or tables are removed or rewritten.

-- CreateTable
CREATE TABLE "ToolExecutionReceipt" (
    "id" TEXT NOT NULL,
    "toolExecutionId" TEXT NOT NULL,
    "buildId" TEXT,
    "receiptKind" TEXT NOT NULL,
    "receiptStatus" TEXT NOT NULL DEFAULT 'valid',
    "inputFingerprint" TEXT NOT NULL,
    "outputDigest" JSONB NOT NULL,
    "executionStatus" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ToolExecutionReceipt_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "BuildArtifactRevision" (
    "id" TEXT NOT NULL,
    "buildId" TEXT NOT NULL,
    "field" TEXT NOT NULL,
    "revisionNumber" INTEGER NOT NULL,
    "value" JSONB NOT NULL,
    "valueDigest" TEXT NOT NULL,
    "savedByUserId" TEXT NOT NULL,
    "savedByAgentId" TEXT,
    "threadId" TEXT,
    "status" TEXT NOT NULL DEFAULT 'accepted',
    "legacyEvidence" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "BuildArtifactRevision_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ArtifactReceiptUsage" (
    "id" TEXT NOT NULL,
    "artifactRevisionId" TEXT NOT NULL,
    "receiptId" TEXT NOT NULL,
    "role" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ArtifactReceiptUsage_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "ToolExecutionReceipt_toolExecutionId_key" ON "ToolExecutionReceipt"("toolExecutionId");

-- CreateIndex
CREATE INDEX "ToolExecutionReceipt_buildId_createdAt_idx" ON "ToolExecutionReceipt"("buildId", "createdAt" DESC);

-- CreateIndex
CREATE INDEX "ToolExecutionReceipt_receiptKind_createdAt_idx" ON "ToolExecutionReceipt"("receiptKind", "createdAt" DESC);

-- CreateIndex
CREATE INDEX "ToolExecutionReceipt_receiptStatus_expiresAt_idx" ON "ToolExecutionReceipt"("receiptStatus", "expiresAt");

-- CreateIndex
CREATE UNIQUE INDEX "BuildArtifactRevision_buildId_field_revisionNumber_key" ON "BuildArtifactRevision"("buildId", "field", "revisionNumber");

-- CreateIndex
CREATE INDEX "BuildArtifactRevision_buildId_field_createdAt_idx" ON "BuildArtifactRevision"("buildId", "field", "createdAt" DESC);

-- CreateIndex
CREATE UNIQUE INDEX "ArtifactReceiptUsage_artifactRevisionId_receiptId_key" ON "ArtifactReceiptUsage"("artifactRevisionId", "receiptId");

-- CreateIndex
CREATE INDEX "ArtifactReceiptUsage_receiptId_idx" ON "ArtifactReceiptUsage"("receiptId");

-- AddForeignKey
ALTER TABLE "ToolExecutionReceipt" ADD CONSTRAINT "ToolExecutionReceipt_toolExecutionId_fkey" FOREIGN KEY ("toolExecutionId") REFERENCES "ToolExecution"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ToolExecutionReceipt" ADD CONSTRAINT "ToolExecutionReceipt_buildId_fkey" FOREIGN KEY ("buildId") REFERENCES "FeatureBuild"("buildId") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BuildArtifactRevision" ADD CONSTRAINT "BuildArtifactRevision_buildId_fkey" FOREIGN KEY ("buildId") REFERENCES "FeatureBuild"("buildId") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ArtifactReceiptUsage" ADD CONSTRAINT "ArtifactReceiptUsage_artifactRevisionId_fkey" FOREIGN KEY ("artifactRevisionId") REFERENCES "BuildArtifactRevision"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ArtifactReceiptUsage" ADD CONSTRAINT "ArtifactReceiptUsage_receiptId_fkey" FOREIGN KEY ("receiptId") REFERENCES "ToolExecutionReceipt"("id") ON DELETE CASCADE ON UPDATE CASCADE;
