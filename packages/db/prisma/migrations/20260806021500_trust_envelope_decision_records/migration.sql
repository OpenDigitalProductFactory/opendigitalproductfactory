-- AlterTable
ALTER TABLE "DecisionInteraction" ADD COLUMN     "chainEntryHash" TEXT,
ADD COLUMN     "chainId" TEXT,
ADD COLUMN     "prevHash" TEXT,
ADD COLUMN     "sealedAt" TIMESTAMP(3);

-- CreateTable
CREATE TABLE "EvidenceReVerification" (
    "id" TEXT NOT NULL,
    "reverificationId" TEXT NOT NULL,
    "interactionId" TEXT NOT NULL,
    "chainEntryHash" TEXT,
    "optionId" TEXT NOT NULL,
    "dimensionKey" TEXT NOT NULL,
    "evidenceLocator" JSONB NOT NULL,
    "recordedExcerpt" TEXT,
    "liveExcerpt" TEXT,
    "resolved" BOOLEAN NOT NULL DEFAULT false,
    "excerptMatch" BOOLEAN NOT NULL DEFAULT false,
    "verdict" TEXT NOT NULL DEFAULT 'pending',
    "verifierRunId" TEXT,
    "checkedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "EvidenceReVerification_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "JurisdictionCriteriaProfile" (
    "id" TEXT NOT NULL,
    "profileKey" TEXT NOT NULL,
    "version" INTEGER NOT NULL DEFAULT 1,
    "industry" TEXT,
    "jurisdiction" TEXT NOT NULL DEFAULT 'global',
    "jurisdictionBasis" TEXT NOT NULL DEFAULT 'global',
    "activityClass" TEXT NOT NULL,
    "requiredAxes" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "forbiddenAxes" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "monitoringOnlyAxes" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "weightOverlay" JSONB NOT NULL DEFAULT '{}',
    "regulationId" TEXT,
    "packVersion" TEXT,
    "rationale" TEXT,
    "sourceKind" TEXT NOT NULL DEFAULT 'operator',
    "status" TEXT NOT NULL DEFAULT 'active',
    "effectiveFrom" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "effectiveUntil" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "JurisdictionCriteriaProfile_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ProtectedMonitoringObservation" (
    "id" TEXT NOT NULL,
    "observationId" TEXT NOT NULL,
    "evaluationRef" TEXT NOT NULL,
    "jurisdiction" TEXT NOT NULL DEFAULT 'global',
    "activityClass" TEXT NOT NULL DEFAULT 'hiring',
    "protectedClass" TEXT NOT NULL,
    "classValue" TEXT NOT NULL,
    "selectionOutcome" TEXT,
    "consentBasis" TEXT NOT NULL DEFAULT 'none',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ProtectedMonitoringObservation_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "EvidenceReVerification_reverificationId_key" ON "EvidenceReVerification"("reverificationId");

-- CreateIndex
CREATE INDEX "EvidenceReVerification_interactionId_idx" ON "EvidenceReVerification"("interactionId");

-- CreateIndex
CREATE INDEX "EvidenceReVerification_verdict_idx" ON "EvidenceReVerification"("verdict");

-- CreateIndex
CREATE INDEX "EvidenceReVerification_chainEntryHash_idx" ON "EvidenceReVerification"("chainEntryHash");

-- CreateIndex
CREATE INDEX "EvidenceReVerification_optionId_dimensionKey_idx" ON "EvidenceReVerification"("optionId", "dimensionKey");

-- CreateIndex
CREATE INDEX "JurisdictionCriteriaProfile_industry_jurisdiction_activityC_idx" ON "JurisdictionCriteriaProfile"("industry", "jurisdiction", "activityClass");

-- CreateIndex
CREATE INDEX "JurisdictionCriteriaProfile_jurisdiction_jurisdictionBasis_idx" ON "JurisdictionCriteriaProfile"("jurisdiction", "jurisdictionBasis");

-- CreateIndex
CREATE INDEX "JurisdictionCriteriaProfile_activityClass_idx" ON "JurisdictionCriteriaProfile"("activityClass");

-- CreateIndex
CREATE INDEX "JurisdictionCriteriaProfile_status_effectiveFrom_effectiveU_idx" ON "JurisdictionCriteriaProfile"("status", "effectiveFrom", "effectiveUntil");

-- CreateIndex
CREATE INDEX "JurisdictionCriteriaProfile_regulationId_idx" ON "JurisdictionCriteriaProfile"("regulationId");

-- CreateIndex
CREATE UNIQUE INDEX "JurisdictionCriteriaProfile_profileKey_version_key" ON "JurisdictionCriteriaProfile"("profileKey", "version");

-- CreateIndex
CREATE UNIQUE INDEX "ProtectedMonitoringObservation_observationId_key" ON "ProtectedMonitoringObservation"("observationId");

-- CreateIndex
CREATE INDEX "ProtectedMonitoringObservation_evaluationRef_idx" ON "ProtectedMonitoringObservation"("evaluationRef");

-- CreateIndex
CREATE INDEX "ProtectedMonitoringObservation_jurisdiction_activityClass_p_idx" ON "ProtectedMonitoringObservation"("jurisdiction", "activityClass", "protectedClass");

-- CreateIndex
CREATE INDEX "ProtectedMonitoringObservation_activityClass_protectedClass_idx" ON "ProtectedMonitoringObservation"("activityClass", "protectedClass", "classValue");

-- CreateIndex
-- @migration-safety: data-safe: chainEntryHash is a NEW nullable column, so every
-- pre-existing DecisionInteraction row is backfilled to NULL. Postgres treats NULLs
-- as distinct in a UNIQUE index (they never collide), so no existing row can violate
-- this constraint. Only newly SEALED rows carry a non-null value, and that value is a
-- sha256 over distinct content (payload || prevHash), so sealed rows cannot collide either.
CREATE UNIQUE INDEX "DecisionInteraction_chainEntryHash_key" ON "DecisionInteraction"("chainEntryHash");

-- CreateIndex
CREATE INDEX "DecisionInteraction_chainId_sealedAt_idx" ON "DecisionInteraction"("chainId", "sealedAt");

-- AddForeignKey
ALTER TABLE "EvidenceReVerification" ADD CONSTRAINT "EvidenceReVerification_interactionId_fkey" FOREIGN KEY ("interactionId") REFERENCES "DecisionInteraction"("interactionId") ON DELETE CASCADE ON UPDATE CASCADE;
