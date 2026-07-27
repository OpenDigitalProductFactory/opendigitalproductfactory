-- @migration-safety: data-safe: creates additive tables and JSON columns with defaults; no existing row is tightened or inferred into active legal authority.
ALTER TABLE "Policy"
  ADD COLUMN "executablePolicyIds" JSONB NOT NULL DEFAULT '[]';

ALTER TABLE "PolicyRequirement"
  ADD COLUMN "executablePolicyIds" JSONB NOT NULL DEFAULT '[]';

CREATE TABLE "DataProcessingActivity" (
  "id" TEXT NOT NULL,
  "activityId" TEXT NOT NULL,
  "organizationId" TEXT NOT NULL,
  "name" TEXT NOT NULL,
  "purposeKey" TEXT NOT NULL,
  "ownerRef" TEXT NOT NULL,
  "status" TEXT NOT NULL DEFAULT 'review',
  "assetIds" JSONB NOT NULL DEFAULT '[]',
  "fieldIds" JSONB NOT NULL DEFAULT '[]',
  "dataCategories" JSONB NOT NULL DEFAULT '[]',
  "subjectTypes" JSONB NOT NULL DEFAULT '[]',
  "authorityRefs" JSONB NOT NULL DEFAULT '[]',
  "recipientRefs" JSONB NOT NULL DEFAULT '[]',
  "destinationClasses" JSONB NOT NULL DEFAULT '[]',
  "residencyConstraints" JSONB NOT NULL DEFAULT '[]',
  "transferConstraints" JSONB NOT NULL DEFAULT '[]',
  "derivedCopyContractIds" JSONB NOT NULL DEFAULT '[]',
  "lifecycleClassIds" JSONB NOT NULL DEFAULT '[]',
  "erasureExceptionRefs" JSONB NOT NULL DEFAULT '[]',
  "controlIds" JSONB NOT NULL DEFAULT '[]',
  "evidenceIds" JSONB NOT NULL DEFAULT '[]',
  "executablePolicyIds" JSONB NOT NULL DEFAULT '[]',
  "controllerProcessorRole" TEXT,
  "riskLevel" TEXT,
  "highRisk" BOOLEAN NOT NULL DEFAULT false,
  "dpiaRequired" BOOLEAN NOT NULL DEFAULT false,
  "effectiveFrom" TIMESTAMP(3),
  "effectiveUntil" TIMESTAMP(3),
  "reviewAt" TIMESTAMP(3),
  "confirmedAt" TIMESTAMP(3),
  "confirmedByRef" TEXT,
  "provenance" JSONB NOT NULL,
  "version" INTEGER NOT NULL DEFAULT 1,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "DataProcessingActivity_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "DataPolicyException" (
  "id" TEXT NOT NULL,
  "exceptionId" TEXT NOT NULL,
  "organizationId" TEXT NOT NULL,
  "name" TEXT NOT NULL,
  "status" TEXT NOT NULL DEFAULT 'draft',
  "scope" JSONB NOT NULL,
  "executablePolicyIds" JSONB NOT NULL DEFAULT '[]',
  "approverRef" TEXT,
  "approvedAt" TIMESTAMP(3),
  "rationale" TEXT,
  "compensatingControl" TEXT,
  "expiresAt" TIMESTAMP(3),
  "remediationItemId" TEXT,
  "provenance" JSONB NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "DataPolicyException_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "DataProcessingActivity_organizationId_activityId_key"
  ON "DataProcessingActivity"("organizationId", "activityId");
CREATE INDEX "DataProcessingActivity_organizationId_status_purposeKey_idx"
  ON "DataProcessingActivity"("organizationId", "status", "purposeKey");
CREATE INDEX "DataProcessingActivity_effectiveUntil_idx"
  ON "DataProcessingActivity"("effectiveUntil");
CREATE INDEX "DataProcessingActivity_reviewAt_idx"
  ON "DataProcessingActivity"("reviewAt");

CREATE UNIQUE INDEX "DataPolicyException_organizationId_exceptionId_key"
  ON "DataPolicyException"("organizationId", "exceptionId");
CREATE INDEX "DataPolicyException_organizationId_status_idx"
  ON "DataPolicyException"("organizationId", "status");
CREATE INDEX "DataPolicyException_expiresAt_idx"
  ON "DataPolicyException"("expiresAt");
CREATE INDEX "DataPolicyException_remediationItemId_idx"
  ON "DataPolicyException"("remediationItemId");

ALTER TABLE "DataProcessingActivity"
  ADD CONSTRAINT "DataProcessingActivity_organizationId_fkey"
  FOREIGN KEY ("organizationId") REFERENCES "Organization"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "DataPolicyException"
  ADD CONSTRAINT "DataPolicyException_organizationId_fkey"
  FOREIGN KEY ("organizationId") REFERENCES "Organization"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;

-- No existing row is backfilled into a confirmed activity. Current industry,
-- jurisdiction, and feature flags lack accountable-owner and authority
-- provenance, so converting them would silently invent legal authorization.
-- Archetype-derived proposals are created by the application as status=review
-- with explicit template provenance when an operator enters the workflow.
