-- CreateTable
CREATE TABLE "CoworkerTurnMetric" (
    "id" TEXT NOT NULL,
    "threadId" TEXT NOT NULL,
    "agentMessageId" TEXT NOT NULL,
    "agentId" TEXT,
    "routeContext" TEXT,
    "taskType" TEXT,
    "providerId" TEXT,
    "modelId" TEXT,
    "dispatches" INTEGER NOT NULL DEFAULT 0,
    "nudges" INTEGER NOT NULL DEFAULT 0,
    "toolsAttached" BOOLEAN NOT NULL DEFAULT false,
    "executedTools" INTEGER NOT NULL DEFAULT 0,
    "totalMs" INTEGER,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CoworkerTurnMetric_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "CoworkerTurnMetric_threadId_agentMessageId_key" ON "CoworkerTurnMetric"("threadId", "agentMessageId");

-- CreateIndex
CREATE INDEX "CoworkerTurnMetric_agentId_routeContext_createdAt_idx" ON "CoworkerTurnMetric"("agentId", "routeContext", "createdAt");

-- CreateIndex
CREATE INDEX "CoworkerTurnMetric_threadId_createdAt_idx" ON "CoworkerTurnMetric"("threadId", "createdAt");
