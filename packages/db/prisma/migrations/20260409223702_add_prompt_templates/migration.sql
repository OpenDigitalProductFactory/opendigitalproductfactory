-- AlterTable
ALTER TABLE "Agent" ALTER COLUMN "updatedAt" DROP DEFAULT;

-- AlterTable
ALTER TABLE "KnowledgeArticle" ADD COLUMN     "abstract" TEXT;

-- AlterTable
ALTER TABLE "PhaseHandoff" ALTER COLUMN "id" DROP DEFAULT;

-- CreateTable
CREATE TABLE "WorkQueue" (
    "id" TEXT NOT NULL,
    "queueId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "queueType" TEXT NOT NULL,
    "teamId" TEXT,
    "routingPolicy" JSONB NOT NULL,
    "slaMinutes" JSONB,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "portfolioId" TEXT,
    "digitalProductId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "WorkQueue_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "WorkItem" (
    "id" TEXT NOT NULL,
    "itemId" TEXT NOT NULL,
    "sourceType" TEXT NOT NULL,
    "sourceId" TEXT,
    "title" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "urgency" TEXT NOT NULL DEFAULT 'routine',
    "effortClass" TEXT NOT NULL DEFAULT 'medium',
    "workerConstraint" JSONB NOT NULL,
    "teamId" TEXT,
    "queueId" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'queued',
    "assignedToType" TEXT,
    "assignedToUserId" TEXT,
    "assignedToAgentId" TEXT,
    "assignedThreadId" TEXT,
    "claimedAt" TIMESTAMP(3),
    "dueAt" TIMESTAMP(3),
    "calendarEventId" TEXT,
    "evidence" JSONB,
    "parentItemId" TEXT,
    "a2aTaskId" TEXT,
    "routingDecision" JSONB,
    "completedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "WorkItem_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "WorkItemMessage" (
    "id" TEXT NOT NULL,
    "messageId" TEXT NOT NULL,
    "workItemId" TEXT NOT NULL,
    "senderType" TEXT NOT NULL,
    "senderUserId" TEXT,
    "senderAgentId" TEXT,
    "messageType" TEXT NOT NULL,
    "body" TEXT NOT NULL,
    "structuredPayload" JSONB,
    "channel" TEXT NOT NULL DEFAULT 'in-app',
    "deliveredAt" TIMESTAMP(3),
    "readAt" TIMESTAMP(3),
    "respondedAt" TIMESTAMP(3),
    "response" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "WorkItemMessage_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "WorkSchedule" (
    "id" TEXT NOT NULL,
    "workerType" TEXT NOT NULL,
    "userId" TEXT,
    "agentId" TEXT,
    "timezone" TEXT NOT NULL DEFAULT 'UTC',
    "workingHours" JSONB NOT NULL,
    "maxConcurrent" INTEGER NOT NULL DEFAULT 5,
    "autoAccept" BOOLEAN NOT NULL DEFAULT false,
    "notificationPrefs" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "WorkSchedule_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PromptTemplate" (
    "id" TEXT NOT NULL,
    "category" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "content" TEXT NOT NULL,
    "contentFormat" TEXT NOT NULL DEFAULT 'markdown',
    "composesFrom" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "variables" JSONB,
    "metadata" JSONB,
    "isOverridden" BOOLEAN NOT NULL DEFAULT false,
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "version" INTEGER NOT NULL DEFAULT 1,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "updatedBy" TEXT,

    CONSTRAINT "PromptTemplate_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PromptRevision" (
    "id" TEXT NOT NULL,
    "templateId" TEXT NOT NULL,
    "version" INTEGER NOT NULL,
    "content" TEXT NOT NULL,
    "metadata" JSONB,
    "changeReason" TEXT,
    "changedBy" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PromptRevision_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "WorkQueue_queueId_key" ON "WorkQueue"("queueId");

-- CreateIndex
CREATE INDEX "WorkQueue_teamId_idx" ON "WorkQueue"("teamId");

-- CreateIndex
CREATE INDEX "WorkQueue_portfolioId_idx" ON "WorkQueue"("portfolioId");

-- CreateIndex
CREATE INDEX "WorkQueue_queueType_isActive_idx" ON "WorkQueue"("queueType", "isActive");

-- CreateIndex
CREATE UNIQUE INDEX "WorkItem_itemId_key" ON "WorkItem"("itemId");

-- CreateIndex
CREATE INDEX "WorkItem_queueId_status_idx" ON "WorkItem"("queueId", "status");

-- CreateIndex
CREATE INDEX "WorkItem_assignedToUserId_status_idx" ON "WorkItem"("assignedToUserId", "status");

-- CreateIndex
CREATE INDEX "WorkItem_assignedToAgentId_status_idx" ON "WorkItem"("assignedToAgentId", "status");

-- CreateIndex
CREATE INDEX "WorkItem_teamId_status_idx" ON "WorkItem"("teamId", "status");

-- CreateIndex
CREATE INDEX "WorkItem_parentItemId_idx" ON "WorkItem"("parentItemId");

-- CreateIndex
CREATE INDEX "WorkItem_sourceType_sourceId_idx" ON "WorkItem"("sourceType", "sourceId");

-- CreateIndex
CREATE INDEX "WorkItem_urgency_status_idx" ON "WorkItem"("urgency", "status");

-- CreateIndex
CREATE INDEX "WorkItem_dueAt_idx" ON "WorkItem"("dueAt");

-- CreateIndex
CREATE UNIQUE INDEX "WorkItemMessage_messageId_key" ON "WorkItemMessage"("messageId");

-- CreateIndex
CREATE INDEX "WorkItemMessage_workItemId_createdAt_idx" ON "WorkItemMessage"("workItemId", "createdAt");

-- CreateIndex
CREATE INDEX "WorkItemMessage_senderUserId_idx" ON "WorkItemMessage"("senderUserId");

-- CreateIndex
CREATE UNIQUE INDEX "WorkSchedule_userId_key" ON "WorkSchedule"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "WorkSchedule_agentId_key" ON "WorkSchedule"("agentId");

-- CreateIndex
CREATE INDEX "PromptTemplate_category_idx" ON "PromptTemplate"("category");

-- CreateIndex
CREATE UNIQUE INDEX "PromptTemplate_category_slug_key" ON "PromptTemplate"("category", "slug");

-- CreateIndex
CREATE INDEX "PromptRevision_templateId_idx" ON "PromptRevision"("templateId");

-- CreateIndex
CREATE UNIQUE INDEX "PromptRevision_templateId_version_key" ON "PromptRevision"("templateId", "version");

-- AddForeignKey
ALTER TABLE "WorkQueue" ADD CONSTRAINT "WorkQueue_teamId_fkey" FOREIGN KEY ("teamId") REFERENCES "ValueStreamTeam"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WorkQueue" ADD CONSTRAINT "WorkQueue_portfolioId_fkey" FOREIGN KEY ("portfolioId") REFERENCES "Portfolio"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WorkQueue" ADD CONSTRAINT "WorkQueue_digitalProductId_fkey" FOREIGN KEY ("digitalProductId") REFERENCES "DigitalProduct"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WorkItem" ADD CONSTRAINT "WorkItem_teamId_fkey" FOREIGN KEY ("teamId") REFERENCES "ValueStreamTeam"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WorkItem" ADD CONSTRAINT "WorkItem_queueId_fkey" FOREIGN KEY ("queueId") REFERENCES "WorkQueue"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WorkItem" ADD CONSTRAINT "WorkItem_assignedToUserId_fkey" FOREIGN KEY ("assignedToUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WorkItem" ADD CONSTRAINT "WorkItem_assignedToAgentId_fkey" FOREIGN KEY ("assignedToAgentId") REFERENCES "Agent"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WorkItem" ADD CONSTRAINT "WorkItem_calendarEventId_fkey" FOREIGN KEY ("calendarEventId") REFERENCES "CalendarEvent"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WorkItem" ADD CONSTRAINT "WorkItem_parentItemId_fkey" FOREIGN KEY ("parentItemId") REFERENCES "WorkItem"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WorkItemMessage" ADD CONSTRAINT "WorkItemMessage_workItemId_fkey" FOREIGN KEY ("workItemId") REFERENCES "WorkItem"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WorkSchedule" ADD CONSTRAINT "WorkSchedule_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WorkSchedule" ADD CONSTRAINT "WorkSchedule_agentId_fkey" FOREIGN KEY ("agentId") REFERENCES "Agent"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PromptRevision" ADD CONSTRAINT "PromptRevision_templateId_fkey" FOREIGN KEY ("templateId") REFERENCES "PromptTemplate"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- RenameIndex
ALTER INDEX "BusinessModelRoleAssignment_userId_businessModelRoleId_productI" RENAME TO "BusinessModelRoleAssignment_userId_businessModelRoleId_prod_key";
