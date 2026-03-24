-- CreateTable
CREATE TABLE "TaskRun" (
    "id" TEXT NOT NULL,
    "taskRunId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "threadId" TEXT,
    "buildId" TEXT,
    "routeContext" TEXT,
    "title" TEXT NOT NULL,
    "objective" TEXT NOT NULL,
    "source" TEXT NOT NULL DEFAULT 'coworker',
    "status" TEXT NOT NULL DEFAULT 'active',
    "authorityScope" JSONB,
    "repeatedPatternKey" TEXT,
    "templateId" TEXT,
    "startedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "completedAt" TIMESTAMP(3),
    "archivedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "TaskRun_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TaskNode" (
    "id" TEXT NOT NULL,
    "taskNodeId" TEXT NOT NULL,
    "taskRunId" TEXT NOT NULL,
    "parentNodeId" TEXT,
    "nodeType" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "objective" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'queued',
    "workerRole" TEXT NOT NULL,
    "dependencyMode" TEXT,
    "authorityEnvelope" JSONB,
    "evidenceContract" JSONB,
    "requestContract" JSONB,
    "routeDecision" JSONB,
    "inputSnapshot" JSONB,
    "outputSnapshot" JSONB,
    "costUsd" DOUBLE PRECISION,
    "latencyMs" INTEGER,
    "inputTokens" INTEGER,
    "outputTokens" INTEGER,
    "influenceLevel" TEXT,
    "supersededByNodeId" TEXT,
    "startedAt" TIMESTAMP(3),
    "completedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "TaskNode_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TaskNodeEdge" (
    "id" TEXT NOT NULL,
    "fromNodeId" TEXT NOT NULL,
    "toNodeId" TEXT NOT NULL,
    "edgeType" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "TaskNodeEdge_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "TaskRun_taskRunId_key" ON "TaskRun"("taskRunId");

-- CreateIndex
CREATE INDEX "TaskRun_userId_status_idx" ON "TaskRun"("userId", "status");

-- CreateIndex
CREATE INDEX "TaskRun_threadId_idx" ON "TaskRun"("threadId");

-- CreateIndex
CREATE INDEX "TaskRun_routeContext_status_idx" ON "TaskRun"("routeContext", "status");

-- CreateIndex
CREATE INDEX "TaskRun_repeatedPatternKey_idx" ON "TaskRun"("repeatedPatternKey");

-- CreateIndex
CREATE UNIQUE INDEX "TaskNode_taskNodeId_key" ON "TaskNode"("taskNodeId");

-- CreateIndex
CREATE INDEX "TaskNode_taskRunId_status_idx" ON "TaskNode"("taskRunId", "status");

-- CreateIndex
CREATE INDEX "TaskNode_parentNodeId_idx" ON "TaskNode"("parentNodeId");

-- CreateIndex
CREATE INDEX "TaskNode_nodeType_status_idx" ON "TaskNode"("nodeType", "status");

-- CreateIndex
CREATE INDEX "TaskNode_workerRole_status_idx" ON "TaskNode"("workerRole", "status");

-- CreateIndex
CREATE INDEX "TaskNodeEdge_toNodeId_idx" ON "TaskNodeEdge"("toNodeId");

-- CreateIndex
CREATE UNIQUE INDEX "TaskNodeEdge_fromNodeId_toNodeId_edgeType_key" ON "TaskNodeEdge"("fromNodeId", "toNodeId", "edgeType");

-- AddForeignKey
ALTER TABLE "TaskRun" ADD CONSTRAINT "TaskRun_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TaskNode" ADD CONSTRAINT "TaskNode_taskRunId_fkey" FOREIGN KEY ("taskRunId") REFERENCES "TaskRun"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TaskNode" ADD CONSTRAINT "TaskNode_parentNodeId_fkey" FOREIGN KEY ("parentNodeId") REFERENCES "TaskNode"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TaskNodeEdge" ADD CONSTRAINT "TaskNodeEdge_fromNodeId_fkey" FOREIGN KEY ("fromNodeId") REFERENCES "TaskNode"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TaskNodeEdge" ADD CONSTRAINT "TaskNodeEdge_toNodeId_fkey" FOREIGN KEY ("toNodeId") REFERENCES "TaskNode"("id") ON DELETE CASCADE ON UPDATE CASCADE;
