-- CreateTable
CREATE TABLE "DecisionPerspectiveProfile" (
    "id" TEXT NOT NULL,
    "profileId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "scope" JSONB NOT NULL DEFAULT '{}',
    "ownerOrganizationId" TEXT,
    "ownerPrincipalId" TEXT,
    "fallbackProfileId" TEXT,
    "currentVersionId" TEXT,
    "defaultResolver" JSONB,
    "autonomyPolicy" JSONB NOT NULL DEFAULT '{}',
    "status" TEXT NOT NULL DEFAULT 'active',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "DecisionPerspectiveProfile_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "DecisionPerspectiveProfileVersion" (
    "id" TEXT NOT NULL,
    "versionId" TEXT NOT NULL,
    "profileId" TEXT NOT NULL,
    "versionNumber" INTEGER NOT NULL,
    "materialFingerprint" TEXT NOT NULL,
    "changeSummary" TEXT,
    "promotedByPrincipalId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "DecisionPerspectiveProfileVersion_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PerspectiveMaterial" (
    "id" TEXT NOT NULL,
    "materialId" TEXT NOT NULL,
    "profileId" TEXT NOT NULL,
    "profileVersionId" TEXT,
    "sourceType" TEXT NOT NULL,
    "sourceRef" JSONB NOT NULL DEFAULT '{}',
    "scope" JSONB NOT NULL DEFAULT '{}',
    "domains" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "freshness" TEXT NOT NULL DEFAULT 'current',
    "stalenessPolicy" JSONB,
    "lastValidatedAt" TIMESTAMP(3),
    "confidenceWeight" DOUBLE PRECISION NOT NULL DEFAULT 0.5,
    "reviewStatus" TEXT NOT NULL DEFAULT 'draft',
    "promotionState" TEXT NOT NULL DEFAULT 'candidate',
    "summary" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PerspectiveMaterial_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "DecisionInteraction" (
    "id" TEXT NOT NULL,
    "interactionId" TEXT NOT NULL,
    "profileId" TEXT NOT NULL,
    "profileVersionId" TEXT NOT NULL,
    "fallbackProfileId" TEXT,
    "buildId" TEXT,
    "taskRunId" TEXT,
    "deliberationRunId" TEXT,
    "routeContext" TEXT,
    "phaseFrom" TEXT,
    "phaseTo" TEXT,
    "question" TEXT NOT NULL,
    "options" JSONB NOT NULL DEFAULT '[]',
    "evidenceBundle" JSONB NOT NULL DEFAULT '{}',
    "sources" JSONB NOT NULL DEFAULT '[]',
    "rationale" TEXT,
    "riskTier" TEXT NOT NULL,
    "confidenceBefore" DOUBLE PRECISION,
    "confidenceAfter" DOUBLE PRECISION,
    "outcomeType" TEXT NOT NULL,
    "outcomePayload" JSONB NOT NULL DEFAULT '{}',
    "humanOutcome" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "DecisionInteraction_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "EscalationCapture" (
    "id" TEXT NOT NULL,
    "escalationId" TEXT NOT NULL,
    "interactionId" TEXT NOT NULL,
    "resolverPrincipalId" TEXT,
    "resolverUserId" TEXT,
    "prompt" TEXT NOT NULL,
    "answer" TEXT,
    "criteria" JSONB NOT NULL DEFAULT '[]',
    "rationale" TEXT,
    "objectionsResolved" JSONB NOT NULL DEFAULT '[]',
    "candidateMaterial" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "EscalationCapture_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "DeferralCapture" (
    "id" TEXT NOT NULL,
    "deferralId" TEXT NOT NULL,
    "interactionId" TEXT NOT NULL,
    "domain" TEXT NOT NULL,
    "gapReason" TEXT NOT NULL,
    "suggestedSourceTypes" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "candidateMaterial" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "DeferralCapture_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "DecisionPerspectiveProfile_profileId_key" ON "DecisionPerspectiveProfile"("profileId");

-- CreateIndex
CREATE UNIQUE INDEX "DecisionPerspectiveProfile_currentVersionId_key" ON "DecisionPerspectiveProfile"("currentVersionId");

-- CreateIndex
CREATE INDEX "DecisionPerspectiveProfile_kind_status_idx" ON "DecisionPerspectiveProfile"("kind", "status");

-- CreateIndex
CREATE INDEX "DecisionPerspectiveProfile_ownerOrganizationId_idx" ON "DecisionPerspectiveProfile"("ownerOrganizationId");

-- CreateIndex
CREATE INDEX "DecisionPerspectiveProfile_ownerPrincipalId_idx" ON "DecisionPerspectiveProfile"("ownerPrincipalId");

-- CreateIndex
CREATE INDEX "DecisionPerspectiveProfile_fallbackProfileId_idx" ON "DecisionPerspectiveProfile"("fallbackProfileId");

-- CreateIndex
CREATE UNIQUE INDEX "DecisionPerspectiveProfileVersion_versionId_key" ON "DecisionPerspectiveProfileVersion"("versionId");

-- CreateIndex
CREATE INDEX "DecisionPerspectiveProfileVersion_profileId_idx" ON "DecisionPerspectiveProfileVersion"("profileId");

-- CreateIndex
CREATE INDEX "DecisionPerspectiveProfileVersion_promotedByPrincipalId_idx" ON "DecisionPerspectiveProfileVersion"("promotedByPrincipalId");

-- CreateIndex
CREATE UNIQUE INDEX "DecisionPerspectiveProfileVersion_profileId_versionNumber_key" ON "DecisionPerspectiveProfileVersion"("profileId", "versionNumber");

-- CreateIndex
CREATE UNIQUE INDEX "PerspectiveMaterial_materialId_key" ON "PerspectiveMaterial"("materialId");

-- CreateIndex
CREATE INDEX "PerspectiveMaterial_profileId_freshness_idx" ON "PerspectiveMaterial"("profileId", "freshness");

-- CreateIndex
CREATE INDEX "PerspectiveMaterial_profileId_reviewStatus_promotionState_idx" ON "PerspectiveMaterial"("profileId", "reviewStatus", "promotionState");

-- CreateIndex
CREATE INDEX "PerspectiveMaterial_profileVersionId_idx" ON "PerspectiveMaterial"("profileVersionId");

-- CreateIndex
CREATE INDEX "PerspectiveMaterial_sourceType_idx" ON "PerspectiveMaterial"("sourceType");

-- CreateIndex
CREATE UNIQUE INDEX "DecisionInteraction_interactionId_key" ON "DecisionInteraction"("interactionId");

-- CreateIndex
CREATE INDEX "DecisionInteraction_profileId_createdAt_idx" ON "DecisionInteraction"("profileId", "createdAt");

-- CreateIndex
CREATE INDEX "DecisionInteraction_profileVersionId_idx" ON "DecisionInteraction"("profileVersionId");

-- CreateIndex
CREATE INDEX "DecisionInteraction_fallbackProfileId_idx" ON "DecisionInteraction"("fallbackProfileId");

-- CreateIndex
CREATE INDEX "DecisionInteraction_buildId_createdAt_idx" ON "DecisionInteraction"("buildId", "createdAt");

-- CreateIndex
CREATE INDEX "DecisionInteraction_taskRunId_idx" ON "DecisionInteraction"("taskRunId");

-- CreateIndex
CREATE INDEX "DecisionInteraction_deliberationRunId_idx" ON "DecisionInteraction"("deliberationRunId");

-- CreateIndex
CREATE INDEX "DecisionInteraction_outcomeType_createdAt_idx" ON "DecisionInteraction"("outcomeType", "createdAt");

-- CreateIndex
CREATE INDEX "DecisionInteraction_riskTier_createdAt_idx" ON "DecisionInteraction"("riskTier", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "EscalationCapture_escalationId_key" ON "EscalationCapture"("escalationId");

-- CreateIndex
CREATE UNIQUE INDEX "EscalationCapture_interactionId_key" ON "EscalationCapture"("interactionId");

-- CreateIndex
CREATE INDEX "EscalationCapture_resolverPrincipalId_idx" ON "EscalationCapture"("resolverPrincipalId");

-- CreateIndex
CREATE INDEX "EscalationCapture_resolverUserId_idx" ON "EscalationCapture"("resolverUserId");

-- CreateIndex
CREATE INDEX "EscalationCapture_candidateMaterial_idx" ON "EscalationCapture"("candidateMaterial");

-- CreateIndex
CREATE UNIQUE INDEX "DeferralCapture_deferralId_key" ON "DeferralCapture"("deferralId");

-- CreateIndex
CREATE UNIQUE INDEX "DeferralCapture_interactionId_key" ON "DeferralCapture"("interactionId");

-- CreateIndex
CREATE INDEX "DeferralCapture_domain_createdAt_idx" ON "DeferralCapture"("domain", "createdAt");

-- CreateIndex
CREATE INDEX "DeferralCapture_gapReason_idx" ON "DeferralCapture"("gapReason");

-- CreateIndex
CREATE INDEX "DeferralCapture_candidateMaterial_idx" ON "DeferralCapture"("candidateMaterial");

-- AddCheck
ALTER TABLE "DecisionPerspectiveProfile" ADD CONSTRAINT "DecisionPerspectiveProfile_kind_check" CHECK ("kind" IN ('platform', 'organization', 'customer', 'team'));

-- AddCheck
ALTER TABLE "DecisionPerspectiveProfile" ADD CONSTRAINT "DecisionPerspectiveProfile_status_check" CHECK ("status" IN ('active', 'draft', 'deprecated', 'archived'));

-- AddCheck
ALTER TABLE "PerspectiveMaterial" ADD CONSTRAINT "PerspectiveMaterial_freshness_check" CHECK ("freshness" IN ('current', 'stale', 'superseded', 'contradicted'));

-- AddCheck
ALTER TABLE "PerspectiveMaterial" ADD CONSTRAINT "PerspectiveMaterial_reviewStatus_check" CHECK ("reviewStatus" IN ('draft', 'approved', 'rejected'));

-- AddCheck
ALTER TABLE "PerspectiveMaterial" ADD CONSTRAINT "PerspectiveMaterial_promotionState_check" CHECK ("promotionState" IN ('candidate', 'promoted', 'revoked'));

-- AddCheck
ALTER TABLE "PerspectiveMaterial" ADD CONSTRAINT "PerspectiveMaterial_confidenceWeight_check" CHECK ("confidenceWeight" >= 0 AND "confidenceWeight" <= 1);

-- AddCheck
ALTER TABLE "DecisionInteraction" ADD CONSTRAINT "DecisionInteraction_riskTier_check" CHECK ("riskTier" IN ('low', 'medium', 'high', 'critical'));

-- AddCheck
ALTER TABLE "DecisionInteraction" ADD CONSTRAINT "DecisionInteraction_outcomeType_check" CHECK ("outcomeType" IN ('recommend', 'arbitrate', 'escalate', 'defer'));

-- AddCheck
ALTER TABLE "DecisionInteraction" ADD CONSTRAINT "DecisionInteraction_confidenceBefore_check" CHECK ("confidenceBefore" IS NULL OR ("confidenceBefore" >= 0 AND "confidenceBefore" <= 1));

-- AddCheck
ALTER TABLE "DecisionInteraction" ADD CONSTRAINT "DecisionInteraction_confidenceAfter_check" CHECK ("confidenceAfter" IS NULL OR ("confidenceAfter" >= 0 AND "confidenceAfter" <= 1));

-- AddForeignKey
ALTER TABLE "DecisionPerspectiveProfile" ADD CONSTRAINT "DecisionPerspectiveProfile_ownerOrganizationId_fkey" FOREIGN KEY ("ownerOrganizationId") REFERENCES "Organization"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DecisionPerspectiveProfile" ADD CONSTRAINT "DecisionPerspectiveProfile_ownerPrincipalId_fkey" FOREIGN KEY ("ownerPrincipalId") REFERENCES "Principal"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DecisionPerspectiveProfile" ADD CONSTRAINT "DecisionPerspectiveProfile_fallbackProfileId_fkey" FOREIGN KEY ("fallbackProfileId") REFERENCES "DecisionPerspectiveProfile"("profileId") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DecisionPerspectiveProfile" ADD CONSTRAINT "DecisionPerspectiveProfile_currentVersionId_fkey" FOREIGN KEY ("currentVersionId") REFERENCES "DecisionPerspectiveProfileVersion"("versionId") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DecisionPerspectiveProfileVersion" ADD CONSTRAINT "DecisionPerspectiveProfileVersion_profileId_fkey" FOREIGN KEY ("profileId") REFERENCES "DecisionPerspectiveProfile"("profileId") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DecisionPerspectiveProfileVersion" ADD CONSTRAINT "DecisionPerspectiveProfileVersion_promotedByPrincipalId_fkey" FOREIGN KEY ("promotedByPrincipalId") REFERENCES "Principal"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PerspectiveMaterial" ADD CONSTRAINT "PerspectiveMaterial_profileId_fkey" FOREIGN KEY ("profileId") REFERENCES "DecisionPerspectiveProfile"("profileId") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PerspectiveMaterial" ADD CONSTRAINT "PerspectiveMaterial_profileVersionId_fkey" FOREIGN KEY ("profileVersionId") REFERENCES "DecisionPerspectiveProfileVersion"("versionId") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DecisionInteraction" ADD CONSTRAINT "DecisionInteraction_profileId_fkey" FOREIGN KEY ("profileId") REFERENCES "DecisionPerspectiveProfile"("profileId") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DecisionInteraction" ADD CONSTRAINT "DecisionInteraction_profileVersionId_fkey" FOREIGN KEY ("profileVersionId") REFERENCES "DecisionPerspectiveProfileVersion"("versionId") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DecisionInteraction" ADD CONSTRAINT "DecisionInteraction_fallbackProfileId_fkey" FOREIGN KEY ("fallbackProfileId") REFERENCES "DecisionPerspectiveProfile"("profileId") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DecisionInteraction" ADD CONSTRAINT "DecisionInteraction_buildId_fkey" FOREIGN KEY ("buildId") REFERENCES "FeatureBuild"("buildId") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DecisionInteraction" ADD CONSTRAINT "DecisionInteraction_taskRunId_fkey" FOREIGN KEY ("taskRunId") REFERENCES "TaskRun"("taskRunId") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DecisionInteraction" ADD CONSTRAINT "DecisionInteraction_deliberationRunId_fkey" FOREIGN KEY ("deliberationRunId") REFERENCES "DeliberationRun"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EscalationCapture" ADD CONSTRAINT "EscalationCapture_interactionId_fkey" FOREIGN KEY ("interactionId") REFERENCES "DecisionInteraction"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EscalationCapture" ADD CONSTRAINT "EscalationCapture_resolverPrincipalId_fkey" FOREIGN KEY ("resolverPrincipalId") REFERENCES "Principal"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EscalationCapture" ADD CONSTRAINT "EscalationCapture_resolverUserId_fkey" FOREIGN KEY ("resolverUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DeferralCapture" ADD CONSTRAINT "DeferralCapture_interactionId_fkey" FOREIGN KEY ("interactionId") REFERENCES "DecisionInteraction"("id") ON DELETE CASCADE ON UPDATE CASCADE;
