-- AlterTable
ALTER TABLE "CodeGraphIndexState" ALTER COLUMN "updatedAt" DROP DEFAULT;

-- AlterTable
ALTER TABLE "FeatureBuild" ADD COLUMN     "deliberationSummary" JSONB;

-- AlterTable
ALTER TABLE "TaskNode" ADD COLUMN     "deliberationRunId" TEXT;

-- CreateTable
CREATE TABLE "DeliberationPattern" (
    "id" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "purpose" TEXT NOT NULL,
    "defaultRoles" JSONB NOT NULL,
    "topologyTemplate" JSONB NOT NULL,
    "activationPolicyHints" JSONB NOT NULL,
    "evidenceRequirements" JSONB NOT NULL,
    "outputContract" JSONB NOT NULL,
    "providerStrategyHints" JSONB NOT NULL,
    "sourceFile" TEXT,
    "status" TEXT NOT NULL DEFAULT 'active',
    "isOverridden" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "DeliberationPattern_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "DeliberationRoleProfile" (
    "id" TEXT NOT NULL,
    "roleId" TEXT NOT NULL,
    "roleName" TEXT NOT NULL,
    "personaGuidance" TEXT NOT NULL,
    "allowedNodeTypes" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "sameModelPersonaAllowed" BOOLEAN NOT NULL DEFAULT true,
    "preferProviderDiversity" BOOLEAN NOT NULL DEFAULT false,
    "requireProviderDiversity" BOOLEAN NOT NULL DEFAULT false,
    "evidenceStrictness" TEXT NOT NULL DEFAULT 'standard',
    "sourceFile" TEXT,
    "isOverridden" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "DeliberationRoleProfile_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "DeliberationRun" (
    "id" TEXT NOT NULL,
    "taskRunId" TEXT NOT NULL,
    "patternId" TEXT NOT NULL,
    "artifactType" TEXT NOT NULL,
    "triggerSource" TEXT NOT NULL,
    "adjudicationMode" TEXT NOT NULL,
    "activatedRiskLevel" TEXT,
    "diversityMode" TEXT NOT NULL,
    "strategyProfile" TEXT NOT NULL,
    "consensusState" TEXT NOT NULL DEFAULT 'pending',
    "maxBranches" INTEGER NOT NULL DEFAULT 4,
    "budgetUsd" DOUBLE PRECISION,
    "metadata" JSONB,
    "startedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "completedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "DeliberationRun_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "DeliberationOutcome" (
    "id" TEXT NOT NULL,
    "deliberationRunId" TEXT NOT NULL,
    "mergedRecommendation" TEXT NOT NULL,
    "rationaleSummary" TEXT NOT NULL,
    "confidence" DOUBLE PRECISION,
    "consensusState" TEXT NOT NULL,
    "evidenceQuality" TEXT,
    "unresolvedRisks" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "diversityLabel" TEXT,
    "branchRoster" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "DeliberationOutcome_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "DeliberationIssueSet" (
    "id" TEXT NOT NULL,
    "deliberationRunId" TEXT NOT NULL,
    "assertions" JSONB NOT NULL DEFAULT '[]',
    "objections" JSONB NOT NULL DEFAULT '[]',
    "rebuttals" JSONB NOT NULL DEFAULT '[]',
    "adjudicationNotes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "DeliberationIssueSet_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ClaimRecord" (
    "id" TEXT NOT NULL,
    "deliberationRunId" TEXT NOT NULL,
    "branchNodeId" TEXT,
    "claimText" TEXT NOT NULL,
    "claimType" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'unresolved',
    "evidenceGrade" TEXT NOT NULL,
    "confidence" DOUBLE PRECISION,
    "supportingSourceIds" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "opposingSourceIds" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ClaimRecord_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "EvidenceBundle" (
    "id" TEXT NOT NULL,
    "deliberationRunId" TEXT NOT NULL,
    "taskNodeId" TEXT,
    "artifactRef" TEXT,
    "retrievalContext" JSONB,
    "summary" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "EvidenceBundle_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "EvidenceSource" (
    "id" TEXT NOT NULL,
    "evidenceBundleId" TEXT NOT NULL,
    "sourceType" TEXT NOT NULL,
    "locator" JSONB NOT NULL,
    "retrievedBy" TEXT,
    "excerpt" TEXT,
    "retrievedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "EvidenceSource_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "DeliberationPattern_slug_key" ON "DeliberationPattern"("slug");

-- CreateIndex
CREATE INDEX "DeliberationPattern_status_idx" ON "DeliberationPattern"("status");

-- CreateIndex
CREATE UNIQUE INDEX "DeliberationRoleProfile_roleId_key" ON "DeliberationRoleProfile"("roleId");

-- CreateIndex
CREATE INDEX "DeliberationRoleProfile_evidenceStrictness_idx" ON "DeliberationRoleProfile"("evidenceStrictness");

-- CreateIndex
CREATE INDEX "DeliberationRun_taskRunId_idx" ON "DeliberationRun"("taskRunId");

-- CreateIndex
CREATE INDEX "DeliberationRun_patternId_idx" ON "DeliberationRun"("patternId");

-- CreateIndex
CREATE INDEX "DeliberationRun_consensusState_idx" ON "DeliberationRun"("consensusState");

-- CreateIndex
CREATE INDEX "DeliberationRun_artifactType_consensusState_idx" ON "DeliberationRun"("artifactType", "consensusState");

-- CreateIndex
CREATE UNIQUE INDEX "DeliberationOutcome_deliberationRunId_key" ON "DeliberationOutcome"("deliberationRunId");

-- CreateIndex
CREATE INDEX "DeliberationOutcome_consensusState_idx" ON "DeliberationOutcome"("consensusState");

-- CreateIndex
CREATE INDEX "DeliberationIssueSet_deliberationRunId_idx" ON "DeliberationIssueSet"("deliberationRunId");

-- CreateIndex
CREATE INDEX "ClaimRecord_deliberationRunId_claimType_idx" ON "ClaimRecord"("deliberationRunId", "claimType");

-- CreateIndex
CREATE INDEX "ClaimRecord_branchNodeId_idx" ON "ClaimRecord"("branchNodeId");

-- CreateIndex
CREATE INDEX "ClaimRecord_status_idx" ON "ClaimRecord"("status");

-- CreateIndex
CREATE INDEX "ClaimRecord_evidenceGrade_idx" ON "ClaimRecord"("evidenceGrade");

-- CreateIndex
CREATE INDEX "EvidenceBundle_deliberationRunId_idx" ON "EvidenceBundle"("deliberationRunId");

-- CreateIndex
CREATE INDEX "EvidenceBundle_taskNodeId_idx" ON "EvidenceBundle"("taskNodeId");

-- CreateIndex
CREATE INDEX "EvidenceSource_evidenceBundleId_idx" ON "EvidenceSource"("evidenceBundleId");

-- CreateIndex
CREATE INDEX "EvidenceSource_sourceType_idx" ON "EvidenceSource"("sourceType");

-- CreateIndex
CREATE INDEX "TaskNode_deliberationRunId_idx" ON "TaskNode"("deliberationRunId");

-- AddForeignKey
ALTER TABLE "TaskNode" ADD CONSTRAINT "TaskNode_deliberationRunId_fkey" FOREIGN KEY ("deliberationRunId") REFERENCES "DeliberationRun"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DeliberationRun" ADD CONSTRAINT "DeliberationRun_taskRunId_fkey" FOREIGN KEY ("taskRunId") REFERENCES "TaskRun"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DeliberationRun" ADD CONSTRAINT "DeliberationRun_patternId_fkey" FOREIGN KEY ("patternId") REFERENCES "DeliberationPattern"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DeliberationOutcome" ADD CONSTRAINT "DeliberationOutcome_deliberationRunId_fkey" FOREIGN KEY ("deliberationRunId") REFERENCES "DeliberationRun"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DeliberationIssueSet" ADD CONSTRAINT "DeliberationIssueSet_deliberationRunId_fkey" FOREIGN KEY ("deliberationRunId") REFERENCES "DeliberationRun"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ClaimRecord" ADD CONSTRAINT "ClaimRecord_deliberationRunId_fkey" FOREIGN KEY ("deliberationRunId") REFERENCES "DeliberationRun"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ClaimRecord" ADD CONSTRAINT "ClaimRecord_branchNodeId_fkey" FOREIGN KEY ("branchNodeId") REFERENCES "TaskNode"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EvidenceBundle" ADD CONSTRAINT "EvidenceBundle_deliberationRunId_fkey" FOREIGN KEY ("deliberationRunId") REFERENCES "DeliberationRun"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EvidenceBundle" ADD CONSTRAINT "EvidenceBundle_taskNodeId_fkey" FOREIGN KEY ("taskNodeId") REFERENCES "TaskNode"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EvidenceSource" ADD CONSTRAINT "EvidenceSource_evidenceBundleId_fkey" FOREIGN KEY ("evidenceBundleId") REFERENCES "EvidenceBundle"("id") ON DELETE CASCADE ON UPDATE CASCADE;
