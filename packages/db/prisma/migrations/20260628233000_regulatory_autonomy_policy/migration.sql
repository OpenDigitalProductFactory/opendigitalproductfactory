-- AlterTable
ALTER TABLE "DecisionShadowLedger"
ADD COLUMN "regulatoryPolicyId" TEXT,
ADD COLUMN "regulatoryEvidence" JSONB NOT NULL DEFAULT '{}';

-- CreateTable
CREATE TABLE "RegulatoryAutonomyPolicy" (
    "id" TEXT NOT NULL,
    "policyId" TEXT NOT NULL,
    "policyKey" TEXT NOT NULL,
    "version" INTEGER NOT NULL DEFAULT 1,
    "industry" TEXT,
    "jurisdiction" TEXT NOT NULL DEFAULT 'global',
    "jurisdictionBasis" TEXT NOT NULL DEFAULT 'global',
    "activityClass" TEXT NOT NULL,
    "maxAutonomyLevel" TEXT NOT NULL DEFAULT 'propose',
    "humanControlRequired" BOOLEAN NOT NULL DEFAULT true,
    "requiredEvidence" JSONB NOT NULL DEFAULT '[]',
    "regulationId" TEXT,
    "rationale" TEXT,
    "sourceKind" TEXT NOT NULL DEFAULT 'operator',
    "status" TEXT NOT NULL DEFAULT 'active',
    "effectiveFrom" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "effectiveUntil" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "RegulatoryAutonomyPolicy_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "RegulatoryAutonomyPolicy_policyId_key" ON "RegulatoryAutonomyPolicy"("policyId");

-- CreateIndex
CREATE UNIQUE INDEX "RegulatoryAutonomyPolicy_policyKey_version_key" ON "RegulatoryAutonomyPolicy"("policyKey", "version");

-- CreateIndex
CREATE INDEX "RegulatoryAutonomyPolicy_status_effectiveFrom_effectiveUntil_idx" ON "RegulatoryAutonomyPolicy"("status", "effectiveFrom", "effectiveUntil");

-- CreateIndex
CREATE INDEX "RegulatoryAutonomyPolicy_industry_jurisdiction_activityClass_idx" ON "RegulatoryAutonomyPolicy"("industry", "jurisdiction", "activityClass");

-- CreateIndex
CREATE INDEX "RegulatoryAutonomyPolicy_jurisdiction_jurisdictionBasis_idx" ON "RegulatoryAutonomyPolicy"("jurisdiction", "jurisdictionBasis");

-- CreateIndex
CREATE INDEX "RegulatoryAutonomyPolicy_activityClass_idx" ON "RegulatoryAutonomyPolicy"("activityClass");

-- CreateIndex
CREATE INDEX "RegulatoryAutonomyPolicy_maxAutonomyLevel_idx" ON "RegulatoryAutonomyPolicy"("maxAutonomyLevel");

-- CreateIndex
CREATE INDEX "RegulatoryAutonomyPolicy_regulationId_idx" ON "RegulatoryAutonomyPolicy"("regulationId");

-- CreateIndex
CREATE INDEX "DecisionShadowLedger_regulatoryPolicyId_idx" ON "DecisionShadowLedger"("regulatoryPolicyId");
