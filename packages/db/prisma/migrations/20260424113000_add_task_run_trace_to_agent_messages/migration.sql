-- Add canonical task trace to coworker chat compatibility records.
ALTER TABLE "AgentMessage"
ADD COLUMN "taskRunId" TEXT;

CREATE INDEX "AgentMessage_taskRunId_createdAt_idx"
ON "AgentMessage"("taskRunId", "createdAt");
