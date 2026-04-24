-- AlterTable
ALTER TABLE "AgentActionProposal" ADD COLUMN "taskRunId" TEXT;

-- AlterTable
ALTER TABLE "ToolExecution" ADD COLUMN "taskRunId" TEXT;

-- CreateIndex
CREATE INDEX "AgentActionProposal_taskRunId_idx" ON "AgentActionProposal"("taskRunId");

-- CreateIndex
CREATE INDEX "ToolExecution_taskRunId_createdAt_idx" ON "ToolExecution"("taskRunId", "createdAt" DESC);
