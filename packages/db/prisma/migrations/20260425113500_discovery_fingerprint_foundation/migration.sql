-- CreateTable
CREATE TABLE "DiscoveryFingerprintObservation" (
    "id" TEXT NOT NULL,
    "observationKey" TEXT NOT NULL,
    "inventoryEntityId" TEXT,
    "discoveryRunId" TEXT,
    "sourceKind" TEXT NOT NULL,
    "signalClass" TEXT NOT NULL,
    "protocol" TEXT,
    "rawEvidenceLocal" JSONB,
    "normalizedEvidence" JSONB NOT NULL,
    "redactionStatus" TEXT NOT NULL DEFAULT 'not_required',
    "evidenceFamilies" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "identityCandidates" JSONB NOT NULL DEFAULT '[]',
    "taxonomyCandidates" JSONB NOT NULL DEFAULT '[]',
    "identityConfidence" DOUBLE PRECISION,
    "taxonomyConfidence" DOUBLE PRECISION,
    "candidateMargin" DOUBLE PRECISION,
    "blastRadiusTier" TEXT NOT NULL DEFAULT 'medium',
    "decisionStatus" TEXT NOT NULL DEFAULT 'pending',
    "reviewReason" TEXT,
    "approvedRuleId" TEXT,
    "firstSeenAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastSeenAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "DiscoveryFingerprintObservation_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "DiscoveryFingerprintReview" (
    "id" TEXT NOT NULL,
    "observationId" TEXT NOT NULL,
    "reviewerType" TEXT NOT NULL,
    "reviewerId" TEXT,
    "decision" TEXT NOT NULL,
    "reason" TEXT,
    "previousStatus" TEXT,
    "nextStatus" TEXT NOT NULL,
    "auditPayload" JSONB NOT NULL DEFAULT '{}',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "DiscoveryFingerprintReview_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "DiscoveryFingerprintRule" (
    "id" TEXT NOT NULL,
    "ruleKey" TEXT NOT NULL,
    "catalogVersionId" TEXT,
    "status" TEXT NOT NULL DEFAULT 'draft',
    "scope" TEXT NOT NULL DEFAULT 'global',
    "matchExpression" JSONB NOT NULL,
    "requiredEvidenceFamilies" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "excludedSignals" JSONB NOT NULL DEFAULT '[]',
    "resolvedIdentity" JSONB NOT NULL,
    "taxonomyNodeId" TEXT,
    "identityConfidence" DOUBLE PRECISION NOT NULL,
    "taxonomyConfidence" DOUBLE PRECISION NOT NULL,
    "source" TEXT NOT NULL DEFAULT 'manual',
    "redactionReport" JSONB NOT NULL DEFAULT '{}',
    "fixtureRefs" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "sourceObservationIds" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "DiscoveryFingerprintRule_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "DiscoveryFingerprintCatalogVersion" (
    "id" TEXT NOT NULL,
    "catalogKey" TEXT NOT NULL,
    "version" TEXT NOT NULL,
    "schemaVersion" TEXT NOT NULL,
    "source" TEXT NOT NULL DEFAULT 'repo',
    "importedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "changelog" TEXT,
    "validation" JSONB NOT NULL DEFAULT '{}',

    CONSTRAINT "DiscoveryFingerprintCatalogVersion_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "DiscoveryFingerprintObservation_observationKey_key" ON "DiscoveryFingerprintObservation"("observationKey");

-- CreateIndex
CREATE INDEX "DiscoveryFingerprintObservation_sourceKind_idx" ON "DiscoveryFingerprintObservation"("sourceKind");

-- CreateIndex
CREATE INDEX "DiscoveryFingerprintObservation_signalClass_idx" ON "DiscoveryFingerprintObservation"("signalClass");

-- CreateIndex
CREATE INDEX "DiscoveryFingerprintObservation_redactionStatus_idx" ON "DiscoveryFingerprintObservation"("redactionStatus");

-- CreateIndex
CREATE INDEX "DiscoveryFingerprintObservation_decisionStatus_idx" ON "DiscoveryFingerprintObservation"("decisionStatus");

-- CreateIndex
CREATE INDEX "DiscoveryFingerprintObservation_blastRadiusTier_idx" ON "DiscoveryFingerprintObservation"("blastRadiusTier");

-- CreateIndex
CREATE INDEX "DiscoveryFingerprintObservation_inventoryEntityId_idx" ON "DiscoveryFingerprintObservation"("inventoryEntityId");

-- CreateIndex
CREATE INDEX "DiscoveryFingerprintObservation_discoveryRunId_idx" ON "DiscoveryFingerprintObservation"("discoveryRunId");

-- CreateIndex
CREATE INDEX "DiscoveryFingerprintReview_observationId_idx" ON "DiscoveryFingerprintReview"("observationId");

-- CreateIndex
CREATE INDEX "DiscoveryFingerprintReview_decision_idx" ON "DiscoveryFingerprintReview"("decision");

-- CreateIndex
CREATE INDEX "DiscoveryFingerprintReview_reviewerType_idx" ON "DiscoveryFingerprintReview"("reviewerType");

-- CreateIndex
CREATE UNIQUE INDEX "DiscoveryFingerprintRule_ruleKey_key" ON "DiscoveryFingerprintRule"("ruleKey");

-- CreateIndex
CREATE INDEX "DiscoveryFingerprintRule_status_idx" ON "DiscoveryFingerprintRule"("status");

-- CreateIndex
CREATE INDEX "DiscoveryFingerprintRule_scope_idx" ON "DiscoveryFingerprintRule"("scope");

-- CreateIndex
CREATE INDEX "DiscoveryFingerprintRule_taxonomyNodeId_idx" ON "DiscoveryFingerprintRule"("taxonomyNodeId");

-- CreateIndex
CREATE INDEX "DiscoveryFingerprintRule_catalogVersionId_idx" ON "DiscoveryFingerprintRule"("catalogVersionId");

-- CreateIndex
CREATE UNIQUE INDEX "DiscoveryFingerprintCatalogVersion_catalogKey_version_key" ON "DiscoveryFingerprintCatalogVersion"("catalogKey", "version");

-- AddForeignKey
ALTER TABLE "DiscoveryFingerprintObservation" ADD CONSTRAINT "DiscoveryFingerprintObservation_inventoryEntityId_fkey" FOREIGN KEY ("inventoryEntityId") REFERENCES "InventoryEntity"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DiscoveryFingerprintObservation" ADD CONSTRAINT "DiscoveryFingerprintObservation_discoveryRunId_fkey" FOREIGN KEY ("discoveryRunId") REFERENCES "DiscoveryRun"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DiscoveryFingerprintObservation" ADD CONSTRAINT "DiscoveryFingerprintObservation_approvedRuleId_fkey" FOREIGN KEY ("approvedRuleId") REFERENCES "DiscoveryFingerprintRule"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DiscoveryFingerprintReview" ADD CONSTRAINT "DiscoveryFingerprintReview_observationId_fkey" FOREIGN KEY ("observationId") REFERENCES "DiscoveryFingerprintObservation"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DiscoveryFingerprintRule" ADD CONSTRAINT "DiscoveryFingerprintRule_catalogVersionId_fkey" FOREIGN KEY ("catalogVersionId") REFERENCES "DiscoveryFingerprintCatalogVersion"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DiscoveryFingerprintRule" ADD CONSTRAINT "DiscoveryFingerprintRule_taxonomyNodeId_fkey" FOREIGN KEY ("taxonomyNodeId") REFERENCES "TaxonomyNode"("id") ON DELETE SET NULL ON UPDATE CASCADE;
