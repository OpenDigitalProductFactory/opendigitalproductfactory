-- CreateTable
CREATE TABLE "EaReferenceModel" (
    "id" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "version" TEXT NOT NULL,
    "authorityType" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'draft',
    "description" TEXT,
    "primaryIndustry" TEXT,
    "sourceSummary" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "EaReferenceModel_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "EaReferenceModelElement" (
    "id" TEXT NOT NULL,
    "modelId" TEXT NOT NULL,
    "parentId" TEXT,
    "kind" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "code" TEXT,
    "description" TEXT,
    "normativeClass" TEXT,
    "sourceReference" TEXT,
    "properties" JSONB NOT NULL DEFAULT '{}',

    CONSTRAINT "EaReferenceModelElement_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "EaReferenceModelArtifact" (
    "id" TEXT NOT NULL,
    "modelId" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "path" TEXT NOT NULL,
    "checksum" TEXT,
    "authority" TEXT NOT NULL,
    "importedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "EaReferenceModelArtifact_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "EaAssessmentScope" (
    "id" TEXT NOT NULL,
    "scopeType" TEXT NOT NULL,
    "scopeRef" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "status" TEXT NOT NULL DEFAULT 'active',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "EaAssessmentScope_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "EaReferenceAssessment" (
    "id" TEXT NOT NULL,
    "scopeId" TEXT NOT NULL,
    "modelId" TEXT NOT NULL,
    "modelElementId" TEXT NOT NULL,
    "coverageStatus" TEXT NOT NULL,
    "mvpIncluded" BOOLEAN NOT NULL DEFAULT true,
    "evidenceSummary" TEXT,
    "rationale" TEXT,
    "confidence" TEXT,
    "assessedById" TEXT,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "EaReferenceAssessment_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "EaReferenceProposal" (
    "id" TEXT NOT NULL,
    "modelId" TEXT,
    "proposalType" TEXT NOT NULL,
    "sourceArtifactId" TEXT,
    "payload" JSONB NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'proposed',
    "proposedByType" TEXT NOT NULL,
    "proposedByRef" TEXT,
    "reviewNotes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "EaReferenceProposal_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "EaReferenceModel_slug_key" ON "EaReferenceModel"("slug");

-- CreateIndex
CREATE INDEX "EaReferenceModelElement_modelId_kind_idx" ON "EaReferenceModelElement"("modelId", "kind");

-- CreateIndex
CREATE INDEX "EaReferenceModelElement_parentId_idx" ON "EaReferenceModelElement"("parentId");

-- CreateIndex
CREATE UNIQUE INDEX "EaReferenceModelElement_modelId_slug_key" ON "EaReferenceModelElement"("modelId", "slug");

-- CreateIndex
CREATE INDEX "EaReferenceModelArtifact_modelId_authority_idx" ON "EaReferenceModelArtifact"("modelId", "authority");

-- CreateIndex
CREATE UNIQUE INDEX "EaReferenceModelArtifact_modelId_path_key" ON "EaReferenceModelArtifact"("modelId", "path");

-- CreateIndex
CREATE UNIQUE INDEX "EaAssessmentScope_scopeType_scopeRef_key" ON "EaAssessmentScope"("scopeType", "scopeRef");

-- CreateIndex
CREATE INDEX "EaReferenceAssessment_modelId_coverageStatus_idx" ON "EaReferenceAssessment"("modelId", "coverageStatus");

-- CreateIndex
CREATE UNIQUE INDEX "EaReferenceAssessment_scopeId_modelElementId_key" ON "EaReferenceAssessment"("scopeId", "modelElementId");

-- CreateIndex
CREATE INDEX "EaReferenceProposal_modelId_status_idx" ON "EaReferenceProposal"("modelId", "status");

-- CreateIndex
CREATE INDEX "EaReferenceProposal_sourceArtifactId_idx" ON "EaReferenceProposal"("sourceArtifactId");

-- AddForeignKey
ALTER TABLE "EaReferenceModelElement" ADD CONSTRAINT "EaReferenceModelElement_modelId_fkey" FOREIGN KEY ("modelId") REFERENCES "EaReferenceModel"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EaReferenceModelElement" ADD CONSTRAINT "EaReferenceModelElement_parentId_fkey" FOREIGN KEY ("parentId") REFERENCES "EaReferenceModelElement"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EaReferenceModelArtifact" ADD CONSTRAINT "EaReferenceModelArtifact_modelId_fkey" FOREIGN KEY ("modelId") REFERENCES "EaReferenceModel"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EaReferenceAssessment" ADD CONSTRAINT "EaReferenceAssessment_scopeId_fkey" FOREIGN KEY ("scopeId") REFERENCES "EaAssessmentScope"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EaReferenceAssessment" ADD CONSTRAINT "EaReferenceAssessment_modelId_fkey" FOREIGN KEY ("modelId") REFERENCES "EaReferenceModel"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EaReferenceAssessment" ADD CONSTRAINT "EaReferenceAssessment_modelElementId_fkey" FOREIGN KEY ("modelElementId") REFERENCES "EaReferenceModelElement"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EaReferenceProposal" ADD CONSTRAINT "EaReferenceProposal_modelId_fkey" FOREIGN KEY ("modelId") REFERENCES "EaReferenceModel"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EaReferenceProposal" ADD CONSTRAINT "EaReferenceProposal_sourceArtifactId_fkey" FOREIGN KEY ("sourceArtifactId") REFERENCES "EaReferenceModelArtifact"("id") ON DELETE SET NULL ON UPDATE CASCADE;
