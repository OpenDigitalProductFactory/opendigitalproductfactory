ALTER TABLE "TaskRun"
ADD COLUMN "contextId" TEXT,
ADD COLUMN "initiatingAgentId" TEXT,
ADD COLUMN "currentAgentId" TEXT,
ADD COLUMN "parentTaskRunId" TEXT,
ADD COLUMN "state" TEXT NOT NULL DEFAULT 'submitted',
ADD COLUMN "a2aMetadata" JSONB,
ADD COLUMN "governanceEnvelope" JSONB;

CREATE INDEX "TaskRun_contextId_idx" ON "TaskRun"("contextId");
CREATE INDEX "TaskRun_parentTaskRunId_idx" ON "TaskRun"("parentTaskRunId");
CREATE INDEX "TaskRun_state_idx" ON "TaskRun"("state");
