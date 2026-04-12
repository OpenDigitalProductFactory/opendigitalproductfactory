-- CreateTable
CREATE TABLE "ScheduledAgentTask" (
    "id" TEXT NOT NULL,
    "taskId" TEXT NOT NULL,
    "agentId" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "prompt" TEXT NOT NULL,
    "routeContext" TEXT NOT NULL,
    "schedule" TEXT NOT NULL,
    "timezone" TEXT NOT NULL DEFAULT 'UTC',
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "ownerUserId" TEXT NOT NULL,
    "lastRunAt" TIMESTAMP(3),
    "nextRunAt" TIMESTAMP(3),
    "lastStatus" TEXT,
    "lastError" TEXT,
    "lastThreadId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ScheduledAgentTask_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "ScheduledAgentTask_taskId_key" ON "ScheduledAgentTask"("taskId");
CREATE INDEX "ScheduledAgentTask_agentId_idx" ON "ScheduledAgentTask"("agentId");
CREATE INDEX "ScheduledAgentTask_ownerUserId_idx" ON "ScheduledAgentTask"("ownerUserId");
CREATE INDEX "ScheduledAgentTask_isActive_nextRunAt_idx" ON "ScheduledAgentTask"("isActive", "nextRunAt");

-- AddForeignKey
ALTER TABLE "ScheduledAgentTask" ADD CONSTRAINT "ScheduledAgentTask_ownerUserId_fkey" FOREIGN KEY ("ownerUserId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
