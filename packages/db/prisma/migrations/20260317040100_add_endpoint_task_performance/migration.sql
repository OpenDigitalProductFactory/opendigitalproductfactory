-- CreateTable: EndpointTaskPerformance
CREATE TABLE "EndpointTaskPerformance" (
    "id" TEXT NOT NULL,
    "endpointId" TEXT NOT NULL,
    "taskType" TEXT NOT NULL,
    "evaluationCount" INTEGER NOT NULL DEFAULT 0,
    "successCount" INTEGER NOT NULL DEFAULT 0,
    "avgOrchestratorScore" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "avgHumanScore" DOUBLE PRECISION,
    "recentScores" DOUBLE PRECISION[] DEFAULT ARRAY[]::DOUBLE PRECISION[],
    "currentInstructions" TEXT,
    "instructionPhase" TEXT NOT NULL DEFAULT 'learning',
    "pinned" BOOLEAN NOT NULL DEFAULT false,
    "blocked" BOOLEAN NOT NULL DEFAULT false,
    "avgLatencyMs" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "avgTokensUsed" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "lastEvaluatedAt" TIMESTAMP(3),
    "lastInstructionUpdateAt" TIMESTAMP(3),
    CONSTRAINT "EndpointTaskPerformance_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "EndpointTaskPerformance_endpointId_taskType_key" ON "EndpointTaskPerformance"("endpointId", "taskType");

-- CreateTable: TaskEvaluation
CREATE TABLE "TaskEvaluation" (
    "id" TEXT NOT NULL,
    "threadId" TEXT NOT NULL,
    "endpointId" TEXT NOT NULL,
    "taskType" TEXT NOT NULL,
    "qualityScore" DOUBLE PRECISION,
    "humanScore" DOUBLE PRECISION,
    "taskContext" TEXT NOT NULL,
    "evaluationNotes" TEXT,
    "routeContext" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "TaskEvaluation_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "TaskEvaluation_endpointId_taskType_createdAt_idx" ON "TaskEvaluation"("endpointId", "taskType", "createdAt");
CREATE INDEX "TaskEvaluation_threadId_idx" ON "TaskEvaluation"("threadId");

-- AlterTable: AgentMessage routing fields
ALTER TABLE "AgentMessage" ADD COLUMN "taskType" TEXT;
ALTER TABLE "AgentMessage" ADD COLUMN "routedEndpointId" TEXT;
