-- AlterTable
ALTER TABLE "ToolExecution" ADD COLUMN "skillId" TEXT;

-- AlterTable
ALTER TABLE "PlatformIssueReport" ADD COLUMN "threadId" TEXT,
ADD COLUMN "taskRunId" TEXT;

-- CreateTable
CREATE TABLE "ImprovementSignal" (
    "id" TEXT NOT NULL,
    "signalId" TEXT NOT NULL,
    "sourceType" TEXT NOT NULL,
    "sourceId" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "description" TEXT,
    "evidence" JSONB NOT NULL DEFAULT '{}',
    "recurrenceCount" INTEGER NOT NULL DEFAULT 1,
    "status" TEXT NOT NULL DEFAULT 'open',
    "routeContext" TEXT,
    "agentId" TEXT,
    "threadId" TEXT,
    "buildId" TEXT,
    "providerId" TEXT,
    "toolName" TEXT,
    "digitalProductId" TEXT,
    "portfolioId" TEXT,
    "suspectedRootCause" TEXT,
    "objectiveImpactHypothesis" TEXT,
    "graphNodeRefs" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "graphEdgeRefs" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "lastSeenAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ImprovementSignal_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SkillUsageEvent" (
    "id" TEXT NOT NULL,
    "eventId" TEXT NOT NULL,
    "skillId" TEXT NOT NULL,
    "agentId" TEXT NOT NULL,
    "userId" TEXT,
    "threadId" TEXT,
    "taskRunId" TEXT,
    "toolExecutionId" TEXT,
    "routeContext" TEXT,
    "phase" TEXT NOT NULL,
    "source" TEXT NOT NULL DEFAULT 'coworker',
    "metadata" JSONB NOT NULL DEFAULT '{}',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "SkillUsageEvent_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "ImprovementSignal_signalId_key" ON "ImprovementSignal"("signalId");

-- CreateIndex
CREATE UNIQUE INDEX "ImprovementSignal_sourceType_sourceId_key" ON "ImprovementSignal"("sourceType", "sourceId");

-- CreateIndex
CREATE INDEX "ImprovementSignal_status_createdAt_idx" ON "ImprovementSignal"("status", "createdAt" DESC);

-- CreateIndex
CREATE INDEX "ImprovementSignal_routeContext_createdAt_idx" ON "ImprovementSignal"("routeContext", "createdAt" DESC);

-- CreateIndex
CREATE INDEX "ImprovementSignal_agentId_createdAt_idx" ON "ImprovementSignal"("agentId", "createdAt" DESC);

-- CreateIndex
CREATE INDEX "ImprovementSignal_toolName_createdAt_idx" ON "ImprovementSignal"("toolName", "createdAt" DESC);

-- CreateIndex
CREATE UNIQUE INDEX "SkillUsageEvent_eventId_key" ON "SkillUsageEvent"("eventId");

-- CreateIndex
CREATE INDEX "SkillUsageEvent_skillId_createdAt_idx" ON "SkillUsageEvent"("skillId", "createdAt" DESC);

-- CreateIndex
CREATE INDEX "SkillUsageEvent_agentId_createdAt_idx" ON "SkillUsageEvent"("agentId", "createdAt" DESC);

-- CreateIndex
CREATE INDEX "SkillUsageEvent_threadId_createdAt_idx" ON "SkillUsageEvent"("threadId", "createdAt" DESC);

-- CreateIndex
CREATE INDEX "SkillUsageEvent_taskRunId_createdAt_idx" ON "SkillUsageEvent"("taskRunId", "createdAt" DESC);

-- CreateIndex
CREATE INDEX "SkillUsageEvent_phase_createdAt_idx" ON "SkillUsageEvent"("phase", "createdAt" DESC);

-- CreateIndex
CREATE INDEX "PlatformIssueReport_threadId_createdAt_idx" ON "PlatformIssueReport"("threadId", "createdAt" DESC);

-- CreateIndex
CREATE INDEX "PlatformIssueReport_taskRunId_idx" ON "PlatformIssueReport"("taskRunId");

-- CreateIndex
CREATE INDEX "ToolExecution_skillId_createdAt_idx" ON "ToolExecution"("skillId", "createdAt" DESC);

-- AddForeignKey
ALTER TABLE "SkillUsageEvent" ADD CONSTRAINT "SkillUsageEvent_skillId_fkey" FOREIGN KEY ("skillId") REFERENCES "SkillDefinition"("skillId") ON DELETE CASCADE ON UPDATE CASCADE;
