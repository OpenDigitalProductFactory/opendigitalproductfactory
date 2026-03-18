-- AlterTable: ModelProvider — add routing manifest fields
ALTER TABLE "ModelProvider" ADD COLUMN IF NOT EXISTS "supportedModalities" JSONB NOT NULL DEFAULT '{"input":["text"],"output":["text"]}';
ALTER TABLE "ModelProvider" ADD COLUMN IF NOT EXISTS "supportsToolUse" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "ModelProvider" ADD COLUMN IF NOT EXISTS "supportsStructuredOutput" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "ModelProvider" ADD COLUMN IF NOT EXISTS "supportsStreaming" BOOLEAN NOT NULL DEFAULT true;
ALTER TABLE "ModelProvider" ADD COLUMN IF NOT EXISTS "maxContextTokens" INTEGER;
ALTER TABLE "ModelProvider" ADD COLUMN IF NOT EXISTS "maxOutputTokens" INTEGER;
ALTER TABLE "ModelProvider" ADD COLUMN IF NOT EXISTS "modelRestrictions" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[];
ALTER TABLE "ModelProvider" ADD COLUMN IF NOT EXISTS "reasoning" INTEGER NOT NULL DEFAULT 50;
ALTER TABLE "ModelProvider" ADD COLUMN IF NOT EXISTS "codegen" INTEGER NOT NULL DEFAULT 50;
ALTER TABLE "ModelProvider" ADD COLUMN IF NOT EXISTS "toolFidelity" INTEGER NOT NULL DEFAULT 50;
ALTER TABLE "ModelProvider" ADD COLUMN IF NOT EXISTS "instructionFollowing" INTEGER NOT NULL DEFAULT 50;
ALTER TABLE "ModelProvider" ADD COLUMN IF NOT EXISTS "structuredOutput" INTEGER NOT NULL DEFAULT 50;
ALTER TABLE "ModelProvider" ADD COLUMN IF NOT EXISTS "conversational" INTEGER NOT NULL DEFAULT 50;
ALTER TABLE "ModelProvider" ADD COLUMN IF NOT EXISTS "contextRetention" INTEGER NOT NULL DEFAULT 50;
ALTER TABLE "ModelProvider" ADD COLUMN IF NOT EXISTS "customScores" JSONB NOT NULL DEFAULT '{}';
ALTER TABLE "ModelProvider" ADD COLUMN IF NOT EXISTS "avgLatencyMs" DOUBLE PRECISION;
ALTER TABLE "ModelProvider" ADD COLUMN IF NOT EXISTS "recentFailureRate" DOUBLE PRECISION NOT NULL DEFAULT 0;
ALTER TABLE "ModelProvider" ADD COLUMN IF NOT EXISTS "lastEvalAt" TIMESTAMP(3);
ALTER TABLE "ModelProvider" ADD COLUMN IF NOT EXISTS "lastCallAt" TIMESTAMP(3);
ALTER TABLE "ModelProvider" ADD COLUMN IF NOT EXISTS "profileSource" TEXT NOT NULL DEFAULT 'seed';
ALTER TABLE "ModelProvider" ADD COLUMN IF NOT EXISTS "profileConfidence" TEXT NOT NULL DEFAULT 'low';
ALTER TABLE "ModelProvider" ADD COLUMN IF NOT EXISTS "evalCount" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "ModelProvider" ADD COLUMN IF NOT EXISTS "retiredAt" TIMESTAMP(3);
ALTER TABLE "ModelProvider" ADD COLUMN IF NOT EXISTS "retiredReason" TEXT;

-- AlterTable: EndpointTaskPerformance — add dimension scores and profile confidence
ALTER TABLE "EndpointTaskPerformance" ADD COLUMN IF NOT EXISTS "dimensionScores" JSONB NOT NULL DEFAULT '{}';
ALTER TABLE "EndpointTaskPerformance" ADD COLUMN IF NOT EXISTS "profileConfidence" TEXT NOT NULL DEFAULT 'low';

-- CreateTable: TaskRequirement
CREATE TABLE IF NOT EXISTS "TaskRequirement" (
    "id" TEXT NOT NULL,
    "taskType" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "selectionRationale" TEXT NOT NULL,
    "requiredCapabilities" JSONB NOT NULL DEFAULT '{}',
    "preferredMinScores" JSONB NOT NULL DEFAULT '{}',
    "maxLatencyMs" INTEGER,
    "preferCheap" BOOLEAN NOT NULL DEFAULT false,
    "defaultInstructions" TEXT,
    "evaluationTokenLimit" INTEGER NOT NULL DEFAULT 500,
    "origin" TEXT NOT NULL DEFAULT 'system',
    "createdById" TEXT,
    "approvedById" TEXT,
    "approvedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "TaskRequirement_pkey" PRIMARY KEY ("id")
);

-- CreateTable: PolicyRule
CREATE TABLE IF NOT EXISTS "PolicyRule" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "condition" JSONB NOT NULL,
    "action" TEXT NOT NULL DEFAULT 'exclude',
    "createdById" TEXT,
    "version" INTEGER NOT NULL DEFAULT 1,
    "effectiveFrom" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "effectiveUntil" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PolicyRule_pkey" PRIMARY KEY ("id")
);

-- CreateTable: RouteDecisionLog
CREATE TABLE IF NOT EXISTS "RouteDecisionLog" (
    "id" TEXT NOT NULL,
    "agentMessageId" TEXT,
    "selectedEndpointId" TEXT NOT NULL,
    "taskType" TEXT NOT NULL,
    "sensitivity" TEXT NOT NULL,
    "reason" TEXT NOT NULL,
    "fitnessScore" DOUBLE PRECISION NOT NULL,
    "candidateTrace" JSONB NOT NULL,
    "excludedTrace" JSONB NOT NULL,
    "policyRulesApplied" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
    "fallbackChain" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
    "fallbacksUsed" JSONB,
    "shadowMode" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "RouteDecisionLog_pkey" PRIMARY KEY ("id")
);

-- CreateTable: CustomEvalDimension
CREATE TABLE IF NOT EXISTS "CustomEvalDimension" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "evalScenarios" JSONB NOT NULL DEFAULT '[]',
    "createdById" TEXT,
    "approvedById" TEXT,
    "status" TEXT NOT NULL DEFAULT 'draft',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CustomEvalDimension_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX IF NOT EXISTS "TaskRequirement_taskType_key" ON "TaskRequirement"("taskType");
CREATE UNIQUE INDEX IF NOT EXISTS "CustomEvalDimension_name_key" ON "CustomEvalDimension"("name");
CREATE INDEX IF NOT EXISTS "RouteDecisionLog_taskType_idx" ON "RouteDecisionLog"("taskType");
CREATE INDEX IF NOT EXISTS "RouteDecisionLog_selectedEndpointId_idx" ON "RouteDecisionLog"("selectedEndpointId");
CREATE INDEX IF NOT EXISTS "RouteDecisionLog_createdAt_idx" ON "RouteDecisionLog"("createdAt");

-- AddForeignKey
ALTER TABLE "TaskRequirement" ADD CONSTRAINT "TaskRequirement_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "TaskRequirement" ADD CONSTRAINT "TaskRequirement_approvedById_fkey" FOREIGN KEY ("approvedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "PolicyRule" ADD CONSTRAINT "PolicyRule_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "CustomEvalDimension" ADD CONSTRAINT "CustomEvalDimension_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "CustomEvalDimension" ADD CONSTRAINT "CustomEvalDimension_approvedById_fkey" FOREIGN KEY ("approvedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- Check constraints: capability scores must be 0-100
ALTER TABLE "ModelProvider" ADD CONSTRAINT "ModelProvider_capability_scores_check"
  CHECK ("reasoning" BETWEEN 0 AND 100 AND "codegen" BETWEEN 0 AND 100
    AND "toolFidelity" BETWEEN 0 AND 100 AND "instructionFollowing" BETWEEN 0 AND 100
    AND "structuredOutput" BETWEEN 0 AND 100 AND "conversational" BETWEEN 0 AND 100
    AND "contextRetention" BETWEEN 0 AND 100);

-- Check constraint: recentFailureRate must be 0-1
ALTER TABLE "ModelProvider" ADD CONSTRAINT "ModelProvider_recentFailureRate_check"
  CHECK ("recentFailureRate" >= 0 AND "recentFailureRate" <= 1);
