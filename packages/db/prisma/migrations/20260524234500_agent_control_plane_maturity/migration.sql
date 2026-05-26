-- CreateTable
CREATE TABLE "CapabilityMaturityAssessment" (
    "id" TEXT NOT NULL,
    "assessmentId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "capabilityCategory" TEXT NOT NULL,
    "riskTier" TEXT NOT NULL,
    "maturityScore" INTEGER NOT NULL,
    "confidenceGrade" TEXT NOT NULL DEFAULT 'claimed',
    "strategicOwnership" TEXT NOT NULL,
    "vendorReplacementConfidence" TEXT NOT NULL DEFAULT 'low',
    "installScope" TEXT NOT NULL DEFAULT 'canonical',
    "archetypeScope" TEXT,
    "productizationStatus" TEXT NOT NULL DEFAULT 'not_eligible',
    "productizationStatusChangedAt" TIMESTAMP(3),
    "parityChecklistEvidence" JSONB NOT NULL DEFAULT '[]',
    "existingPrimitives" JSONB NOT NULL DEFAULT '[]',
    "maturityGaps" JSONB NOT NULL DEFAULT '[]',
    "evidenceSources" JSONB NOT NULL DEFAULT '[]',
    "hiveMindSignals" JSONB NOT NULL DEFAULT '[]',
    "kernelPrinciples" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "operationalSurface" TEXT,
    "hasContinuousEvidence" BOOLEAN NOT NULL DEFAULT false,
    "evidenceFreshnessAt" TIMESTAMP(3),
    "lastGovernanceReviewAt" TIMESTAMP(3),
    "lastAssessmentAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "assessedBy" TEXT NOT NULL DEFAULT 'seed',
    "portfolioId" TEXT NOT NULL,
    "taxonomyNodeId" TEXT,
    "eaElementId" TEXT,
    "digitalProductId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CapabilityMaturityAssessment_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CapabilityMaturityDependency" (
    "id" TEXT NOT NULL,
    "assessmentId" TEXT NOT NULL,
    "dependencyId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CapabilityMaturityDependency_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "CapabilityMaturityAssessment_assessmentId_key" ON "CapabilityMaturityAssessment"("assessmentId");

-- CreateIndex
CREATE INDEX "CapabilityMaturityAssessment_portfolioId_idx" ON "CapabilityMaturityAssessment"("portfolioId");

-- CreateIndex
CREATE INDEX "CapabilityMaturityAssessment_taxonomyNodeId_idx" ON "CapabilityMaturityAssessment"("taxonomyNodeId");

-- CreateIndex
CREATE INDEX "CapabilityMaturityAssessment_eaElementId_idx" ON "CapabilityMaturityAssessment"("eaElementId");

-- CreateIndex
CREATE INDEX "CapabilityMaturityAssessment_digitalProductId_idx" ON "CapabilityMaturityAssessment"("digitalProductId");

-- CreateIndex
CREATE INDEX "CapabilityMaturityAssessment_capabilityCategory_idx" ON "CapabilityMaturityAssessment"("capabilityCategory");

-- CreateIndex
CREATE INDEX "CapabilityMaturityAssessment_riskTier_idx" ON "CapabilityMaturityAssessment"("riskTier");

-- CreateIndex
CREATE INDEX "CapabilityMaturityAssessment_installScope_idx" ON "CapabilityMaturityAssessment"("installScope");

-- CreateIndex
CREATE INDEX "CapabilityMaturityAssessment_productizationStatus_idx" ON "CapabilityMaturityAssessment"("productizationStatus");

-- CreateIndex
CREATE INDEX "CapabilityMaturityDependency_dependencyId_idx" ON "CapabilityMaturityDependency"("dependencyId");

-- CreateIndex
CREATE UNIQUE INDEX "CapabilityMaturityDependency_assessmentId_dependencyId_key" ON "CapabilityMaturityDependency"("assessmentId", "dependencyId");

-- AddForeignKey
ALTER TABLE "CapabilityMaturityAssessment" ADD CONSTRAINT "CapabilityMaturityAssessment_portfolioId_fkey" FOREIGN KEY ("portfolioId") REFERENCES "Portfolio"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CapabilityMaturityAssessment" ADD CONSTRAINT "CapabilityMaturityAssessment_taxonomyNodeId_fkey" FOREIGN KEY ("taxonomyNodeId") REFERENCES "TaxonomyNode"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CapabilityMaturityAssessment" ADD CONSTRAINT "CapabilityMaturityAssessment_eaElementId_fkey" FOREIGN KEY ("eaElementId") REFERENCES "EaElement"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CapabilityMaturityAssessment" ADD CONSTRAINT "CapabilityMaturityAssessment_digitalProductId_fkey" FOREIGN KEY ("digitalProductId") REFERENCES "DigitalProduct"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CapabilityMaturityDependency" ADD CONSTRAINT "CapabilityMaturityDependency_assessmentId_fkey" FOREIGN KEY ("assessmentId") REFERENCES "CapabilityMaturityAssessment"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CapabilityMaturityDependency" ADD CONSTRAINT "CapabilityMaturityDependency_dependencyId_fkey" FOREIGN KEY ("dependencyId") REFERENCES "CapabilityMaturityAssessment"("id") ON DELETE CASCADE ON UPDATE CASCADE;
