-- CreateTable
CREATE TABLE "TaskMessage" (
    "id" TEXT NOT NULL,
    "messageId" TEXT NOT NULL,
    "taskRunId" TEXT NOT NULL,
    "contextId" TEXT,
    "role" TEXT NOT NULL,
    "parts" JSONB NOT NULL,
    "metadata" JSONB,
    "referenceTaskIds" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "TaskMessage_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TaskArtifact" (
    "id" TEXT NOT NULL,
    "artifactId" TEXT NOT NULL,
    "taskRunId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "parts" JSONB NOT NULL,
    "metadata" JSONB,
    "producerAgentId" TEXT,
    "producerNodeId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "TaskArtifact_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "TaskMessage_messageId_key" ON "TaskMessage"("messageId");

-- CreateIndex
CREATE INDEX "TaskMessage_taskRunId_createdAt_idx" ON "TaskMessage"("taskRunId", "createdAt");

-- CreateIndex
CREATE INDEX "TaskMessage_contextId_idx" ON "TaskMessage"("contextId");

-- CreateIndex
CREATE UNIQUE INDEX "TaskArtifact_artifactId_key" ON "TaskArtifact"("artifactId");

-- CreateIndex
CREATE INDEX "TaskArtifact_taskRunId_createdAt_idx" ON "TaskArtifact"("taskRunId", "createdAt");

-- CreateIndex
CREATE INDEX "TaskArtifact_producerAgentId_idx" ON "TaskArtifact"("producerAgentId");

-- CreateIndex
CREATE INDEX "TaskArtifact_producerNodeId_idx" ON "TaskArtifact"("producerNodeId");

-- AddForeignKey
ALTER TABLE "TaskMessage" ADD CONSTRAINT "TaskMessage_taskRunId_fkey" FOREIGN KEY ("taskRunId") REFERENCES "TaskRun"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TaskArtifact" ADD CONSTRAINT "TaskArtifact_taskRunId_fkey" FOREIGN KEY ("taskRunId") REFERENCES "TaskRun"("id") ON DELETE CASCADE ON UPDATE CASCADE;
