-- EP-SKILL-001: AI Coworker Skills Marketplace models

-- SkillDefinition: marketplace skill metadata and SKILL.md content
CREATE TABLE "SkillDefinition" (
    "id" TEXT NOT NULL,
    "skillId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "version" TEXT NOT NULL DEFAULT '1.0.0',
    "sourceType" TEXT NOT NULL,
    "sourceUrl" TEXT,
    "sourceRegistry" TEXT,
    "skillMdContent" TEXT NOT NULL,
    "category" TEXT NOT NULL,
    "tags" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "author" TEXT,
    "license" TEXT,
    "riskBand" TEXT NOT NULL DEFAULT 'low',
    "status" TEXT NOT NULL DEFAULT 'discovered',
    "evaluationId" TEXT,
    "installedAt" TIMESTAMP(3),
    "lastTestedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "SkillDefinition_pkey" PRIMARY KEY ("id")
);

-- SkillAssignment: per-agent skill binding with priority
CREATE TABLE "SkillAssignment" (
    "id" TEXT NOT NULL,
    "skillId" TEXT NOT NULL,
    "agentId" TEXT NOT NULL,
    "priority" INTEGER NOT NULL DEFAULT 0,
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "assignedBy" TEXT NOT NULL,
    "assignedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "SkillAssignment_pkey" PRIMARY KEY ("id")
);

-- SkillMetric: per-skill per-agent period metrics
CREATE TABLE "SkillMetric" (
    "id" TEXT NOT NULL,
    "skillId" TEXT NOT NULL,
    "agentId" TEXT NOT NULL,
    "period" TEXT NOT NULL,
    "invocationCount" INTEGER NOT NULL DEFAULT 0,
    "successCount" INTEGER NOT NULL DEFAULT 0,
    "userRating" DOUBLE PRECISION,
    "avgLatencyMs" INTEGER,
    "feedbackNotes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "SkillMetric_pkey" PRIMARY KEY ("id")
);

-- Unique constraints
CREATE UNIQUE INDEX "SkillDefinition_skillId_key" ON "SkillDefinition"("skillId");
CREATE UNIQUE INDEX "SkillAssignment_skillId_agentId_key" ON "SkillAssignment"("skillId", "agentId");
CREATE UNIQUE INDEX "SkillMetric_skillId_agentId_period_key" ON "SkillMetric"("skillId", "agentId", "period");

-- Performance indexes
CREATE INDEX "SkillDefinition_status_idx" ON "SkillDefinition"("status");
CREATE INDEX "SkillDefinition_category_idx" ON "SkillDefinition"("category");
CREATE INDEX "SkillDefinition_sourceType_idx" ON "SkillDefinition"("sourceType");
CREATE INDEX "SkillAssignment_agentId_idx" ON "SkillAssignment"("agentId");
CREATE INDEX "SkillMetric_skillId_idx" ON "SkillMetric"("skillId");

-- Foreign keys
ALTER TABLE "SkillDefinition" ADD CONSTRAINT "SkillDefinition_evaluationId_fkey" FOREIGN KEY ("evaluationId") REFERENCES "ToolEvaluation"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "SkillAssignment" ADD CONSTRAINT "SkillAssignment_skillId_fkey" FOREIGN KEY ("skillId") REFERENCES "SkillDefinition"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "SkillMetric" ADD CONSTRAINT "SkillMetric_skillId_fkey" FOREIGN KEY ("skillId") REFERENCES "SkillDefinition"("id") ON DELETE CASCADE ON UPDATE CASCADE;
