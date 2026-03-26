-- CreateTable
CREATE TABLE "ToolExecution" (
    "id" TEXT NOT NULL,
    "threadId" TEXT NOT NULL,
    "agentId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "toolName" TEXT NOT NULL,
    "parameters" JSONB NOT NULL,
    "result" JSONB NOT NULL,
    "success" BOOLEAN NOT NULL,
    "executionMode" TEXT NOT NULL,
    "routeContext" TEXT,
    "durationMs" INTEGER,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ToolExecution_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "ToolExecution_agentId_createdAt_idx" ON "ToolExecution"("agentId", "createdAt");

-- CreateIndex
CREATE INDEX "ToolExecution_userId_createdAt_idx" ON "ToolExecution"("userId", "createdAt");

-- CreateIndex
CREATE INDEX "ToolExecution_toolName_createdAt_idx" ON "ToolExecution"("toolName", "createdAt");

-- CreateIndex
CREATE INDEX "ToolExecution_threadId_idx" ON "ToolExecution"("threadId");
