-- CreateEnum
CREATE TYPE "IntakeSource" AS ENUM (
  'user_conversation',
  'artifact_reference',
  'existing_example',
  'coworker_proposal',
  'innovation_radar'
);

-- CreateEnum
CREATE TYPE "BriefConfidence" AS ENUM (
  'high',
  'medium',
  'low'
);

-- CreateEnum
CREATE TYPE "BriefStatus" AS ENUM (
  'draft',
  'gathering_evidence',
  'redacting',
  'interpreting',
  'awaiting_clarification',
  'accepted',
  'converted_to_build',
  'rejected',
  'superseded'
);

-- CreateTable
CREATE TABLE "BusinessBuildBrief" (
  "id" TEXT NOT NULL,
  "briefId" TEXT NOT NULL,
  "orgId" TEXT NOT NULL,
  "status" "BriefStatus" NOT NULL,
  "intakeSource" "IntakeSource" NOT NULL,
  "capabilityPackId" TEXT,
  "featureBuildId" TEXT,
  "backlogItemId" TEXT,
  "businessOutcome" TEXT NOT NULL,
  "affectedPeople" JSONB NOT NULL DEFAULT '[]',
  "affectedWorkflow" TEXT,
  "sourceEvidence" JSONB NOT NULL DEFAULT '[]',
  "successSignals" TEXT[],
  "constraints" TEXT[],
  "businessInterpretation" TEXT,
  "technicalInterpretation" JSONB NOT NULL DEFAULT '{}',
  "riskProfile" JSONB NOT NULL DEFAULT '{}',
  "hiveReadiness" JSONB NOT NULL DEFAULT '{}',
  "openQuestions" TEXT[],
  "confidence" "BriefConfidence",
  "confidenceRationale" TEXT,
  "submittedByAgentId" TEXT,
  "submittedByPseudonym" TEXT,
  "submittedByUserId" TEXT,
  "acceptedByUserId" TEXT,
  "acceptedAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,

  CONSTRAINT "BusinessBuildBrief_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "BusinessBuildBrief_briefId_key" ON "BusinessBuildBrief"("briefId");

-- CreateIndex
CREATE UNIQUE INDEX "BusinessBuildBrief_featureBuildId_key" ON "BusinessBuildBrief"("featureBuildId");

-- CreateIndex
CREATE INDEX "BusinessBuildBrief_orgId_status_idx" ON "BusinessBuildBrief"("orgId", "status");

-- CreateIndex
CREATE INDEX "BusinessBuildBrief_orgId_capabilityPackId_idx" ON "BusinessBuildBrief"("orgId", "capabilityPackId");

-- CreateIndex
CREATE INDEX "BusinessBuildBrief_featureBuildId_idx" ON "BusinessBuildBrief"("featureBuildId");
