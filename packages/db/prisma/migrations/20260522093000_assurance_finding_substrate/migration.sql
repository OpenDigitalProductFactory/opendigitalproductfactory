-- CreateTable
CREATE TABLE "AssuranceFinding" (
    "id" TEXT NOT NULL,
    "findingKey" TEXT NOT NULL,
    "assuranceRunId" TEXT,
    "findingKind" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "description" TEXT,
    "affectedType" TEXT NOT NULL,
    "affectedId" TEXT NOT NULL,
    "adapterKey" TEXT NOT NULL,
    "vendorIdentifier" TEXT NOT NULL,
    "sourceSeverity" TEXT,
    "policySeverity" TEXT NOT NULL,
    "releaseImpact" TEXT NOT NULL DEFAULT 'track',
    "reachability" TEXT NOT NULL DEFAULT 'unknown',
    "exposure" TEXT NOT NULL DEFAULT 'unknown',
    "identifierStability" TEXT NOT NULL DEFAULT 'strong',
    "reopenCount" INTEGER NOT NULL DEFAULT 0,
    "status" TEXT NOT NULL DEFAULT 'open',
    "firstSeenAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastSeenAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "resolvedAt" TIMESTAMP(3),
    "acceptedUntil" TIMESTAMP(3),
    "ownerAgentId" TEXT,
    "ownerUserId" TEXT,
    "source" JSONB NOT NULL DEFAULT '{}',
    "evidence" JSONB NOT NULL DEFAULT '{}',
    "remediationHint" JSONB NOT NULL DEFAULT '{}',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "buildId" TEXT,
    "digitalProductId" TEXT,
    "bomDocumentId" TEXT,
    "bomComponentId" TEXT,

    CONSTRAINT "AssuranceFinding_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "AssuranceFinding_findingKey_key" ON "AssuranceFinding"("findingKey");

-- CreateIndex
CREATE INDEX "AssuranceFinding_findingKind_status_idx" ON "AssuranceFinding"("findingKind", "status");

-- CreateIndex
CREATE INDEX "AssuranceFinding_affectedType_affectedId_idx" ON "AssuranceFinding"("affectedType", "affectedId");

-- CreateIndex
CREATE INDEX "AssuranceFinding_policySeverity_releaseImpact_idx" ON "AssuranceFinding"("policySeverity", "releaseImpact");

-- CreateIndex
CREATE INDEX "AssuranceFinding_lastSeenAt_idx" ON "AssuranceFinding"("lastSeenAt");

-- CreateIndex
CREATE INDEX "AssuranceFinding_assuranceRunId_idx" ON "AssuranceFinding"("assuranceRunId");

-- CreateIndex
CREATE INDEX "AssuranceFinding_buildId_status_idx" ON "AssuranceFinding"("buildId", "status");

-- CreateIndex
CREATE INDEX "AssuranceFinding_digitalProductId_status_idx" ON "AssuranceFinding"("digitalProductId", "status");

-- CreateIndex
CREATE INDEX "AssuranceFinding_bomDocumentId_idx" ON "AssuranceFinding"("bomDocumentId");

-- CreateIndex
CREATE INDEX "AssuranceFinding_bomComponentId_idx" ON "AssuranceFinding"("bomComponentId");

-- CreateIndex
CREATE INDEX "AssuranceFinding_adapterKey_findingKind_idx" ON "AssuranceFinding"("adapterKey", "findingKind");

-- AddForeignKey
ALTER TABLE "AssuranceFinding" ADD CONSTRAINT "AssuranceFinding_assuranceRunId_fkey" FOREIGN KEY ("assuranceRunId") REFERENCES "AssuranceRun"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AssuranceFinding" ADD CONSTRAINT "AssuranceFinding_buildId_fkey" FOREIGN KEY ("buildId") REFERENCES "FeatureBuild"("buildId") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AssuranceFinding" ADD CONSTRAINT "AssuranceFinding_digitalProductId_fkey" FOREIGN KEY ("digitalProductId") REFERENCES "DigitalProduct"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AssuranceFinding" ADD CONSTRAINT "AssuranceFinding_bomDocumentId_fkey" FOREIGN KEY ("bomDocumentId") REFERENCES "BomDocument"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AssuranceFinding" ADD CONSTRAINT "AssuranceFinding_bomComponentId_fkey" FOREIGN KEY ("bomComponentId") REFERENCES "BomComponent"("id") ON DELETE SET NULL ON UPDATE CASCADE;
