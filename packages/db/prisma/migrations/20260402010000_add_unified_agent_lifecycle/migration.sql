-- EP-AI-WORKFORCE-001: Unified Agent Lifecycle Management
-- Add new fields to Agent model and create related tables

-- Agent model extensions
ALTER TABLE "Agent" ADD COLUMN "slugId" TEXT;
ALTER TABLE "Agent" ADD COLUMN "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP;
ALTER TABLE "Agent" ADD COLUMN "valueStream" TEXT;
ALTER TABLE "Agent" ADD COLUMN "it4itSections" TEXT[] DEFAULT ARRAY[]::TEXT[];
ALTER TABLE "Agent" ADD COLUMN "sensitivity" TEXT NOT NULL DEFAULT 'internal';
ALTER TABLE "Agent" ADD COLUMN "humanSupervisorId" TEXT;
ALTER TABLE "Agent" ADD COLUMN "hitlTierDefault" INTEGER NOT NULL DEFAULT 3;
ALTER TABLE "Agent" ADD COLUMN "escalatesTo" TEXT;
ALTER TABLE "Agent" ADD COLUMN "delegatesTo" TEXT[] DEFAULT ARRAY[]::TEXT[];
ALTER TABLE "Agent" ADD COLUMN "lifecycleStage" TEXT NOT NULL DEFAULT 'production';

CREATE UNIQUE INDEX "Agent_slugId_key" ON "Agent"("slugId");

-- AgentExecutionConfig
CREATE TABLE "AgentExecutionConfig" (
    "id" TEXT NOT NULL,
    "agentId" TEXT NOT NULL,
    "defaultModelId" TEXT,
    "temperature" DOUBLE PRECISION NOT NULL DEFAULT 0.3,
    "maxTokens" INTEGER NOT NULL DEFAULT 4096,
    "executionType" TEXT NOT NULL DEFAULT 'in_process',
    "timeoutSeconds" INTEGER NOT NULL DEFAULT 120,
    "concurrencyLimit" INTEGER NOT NULL DEFAULT 4,
    "dailyTokenLimit" INTEGER NOT NULL DEFAULT 200000,
    "perTaskTokenLimit" INTEGER NOT NULL DEFAULT 20000,
    "memoryType" TEXT NOT NULL DEFAULT 'session',
    "memoryBackend" TEXT,

    CONSTRAINT "AgentExecutionConfig_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "AgentExecutionConfig_agentId_key" ON "AgentExecutionConfig"("agentId");

ALTER TABLE "AgentExecutionConfig" ADD CONSTRAINT "AgentExecutionConfig_agentId_fkey" FOREIGN KEY ("agentId") REFERENCES "Agent"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AgentSkillAssignment
CREATE TABLE "AgentSkillAssignment" (
    "id" TEXT NOT NULL,
    "agentId" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "capability" TEXT,
    "prompt" TEXT NOT NULL,
    "taskType" TEXT NOT NULL DEFAULT 'conversation',
    "sortOrder" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "AgentSkillAssignment_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "AgentSkillAssignment_agentId_label_key" ON "AgentSkillAssignment"("agentId", "label");
CREATE INDEX "AgentSkillAssignment_agentId_idx" ON "AgentSkillAssignment"("agentId");

ALTER TABLE "AgentSkillAssignment" ADD CONSTRAINT "AgentSkillAssignment_agentId_fkey" FOREIGN KEY ("agentId") REFERENCES "Agent"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AgentToolGrant
CREATE TABLE "AgentToolGrant" (
    "id" TEXT NOT NULL,
    "agentId" TEXT NOT NULL,
    "grantKey" TEXT NOT NULL,
    "grantedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "grantedBy" TEXT,

    CONSTRAINT "AgentToolGrant_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "AgentToolGrant_agentId_grantKey_key" ON "AgentToolGrant"("agentId", "grantKey");
CREATE INDEX "AgentToolGrant_grantKey_idx" ON "AgentToolGrant"("grantKey");

ALTER TABLE "AgentToolGrant" ADD CONSTRAINT "AgentToolGrant_agentId_fkey" FOREIGN KEY ("agentId") REFERENCES "Agent"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AgentPerformance
CREATE TABLE "AgentPerformance" (
    "id" TEXT NOT NULL,
    "agentId" TEXT NOT NULL,
    "taskType" TEXT NOT NULL,
    "evaluationCount" INTEGER NOT NULL DEFAULT 0,
    "successCount" INTEGER NOT NULL DEFAULT 0,
    "avgOrchestratorScore" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "avgHumanScore" DOUBLE PRECISION,
    "recentScores" DOUBLE PRECISION[] DEFAULT ARRAY[]::DOUBLE PRECISION[],
    "instructionPhase" TEXT NOT NULL DEFAULT 'learning',
    "profileConfidence" TEXT NOT NULL DEFAULT 'low',
    "lastEvaluatedAt" TIMESTAMP(3),

    CONSTRAINT "AgentPerformance_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "AgentPerformance_agentId_taskType_key" ON "AgentPerformance"("agentId", "taskType");
CREATE INDEX "AgentPerformance_agentId_idx" ON "AgentPerformance"("agentId");

ALTER TABLE "AgentPerformance" ADD CONSTRAINT "AgentPerformance_agentId_fkey" FOREIGN KEY ("agentId") REFERENCES "Agent"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- FeatureDegradationMapping
CREATE TABLE "FeatureDegradationMapping" (
    "id" TEXT NOT NULL,
    "agentId" TEXT NOT NULL,
    "featureRoute" TEXT NOT NULL,
    "featureName" TEXT NOT NULL,
    "requiredTier" TEXT NOT NULL,
    "degradationMode" TEXT NOT NULL,
    "fallbackAgentId" TEXT,
    "userMessage" TEXT,

    CONSTRAINT "FeatureDegradationMapping_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "FeatureDegradationMapping_agentId_featureRoute_key" ON "FeatureDegradationMapping"("agentId", "featureRoute");
CREATE INDEX "FeatureDegradationMapping_agentId_idx" ON "FeatureDegradationMapping"("agentId");

ALTER TABLE "FeatureDegradationMapping" ADD CONSTRAINT "FeatureDegradationMapping_agentId_fkey" FOREIGN KEY ("agentId") REFERENCES "Agent"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AgentPromptContext
CREATE TABLE "AgentPromptContext" (
    "id" TEXT NOT NULL,
    "agentId" TEXT NOT NULL,
    "perspective" TEXT,
    "heuristics" TEXT,
    "interpretiveModel" TEXT,
    "domainTools" TEXT[] DEFAULT ARRAY[]::TEXT[],

    CONSTRAINT "AgentPromptContext_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "AgentPromptContext_agentId_key" ON "AgentPromptContext"("agentId");

ALTER TABLE "AgentPromptContext" ADD CONSTRAINT "AgentPromptContext_agentId_fkey" FOREIGN KEY ("agentId") REFERENCES "Agent"("id") ON DELETE CASCADE ON UPDATE CASCADE;
