-- CreateTable
CREATE TABLE "AgentActionProposal" (
    "id" TEXT NOT NULL,
    "proposalId" TEXT NOT NULL,
    "threadId" TEXT NOT NULL,
    "messageId" TEXT NOT NULL,
    "agentId" TEXT NOT NULL,
    "actionType" TEXT NOT NULL,
    "parameters" JSONB NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'proposed',
    "proposedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "decidedAt" TIMESTAMP(3),
    "decidedById" TEXT,
    "executedAt" TIMESTAMP(3),
    "resultEntityId" TEXT,
    "resultError" TEXT,

    CONSTRAINT "AgentActionProposal_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ApiToken" (
    "id" TEXT NOT NULL,
    "token" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ApiToken_pkey" PRIMARY KEY ("id")
);

-- AlterTable
ALTER TABLE "ModelProfile" ADD COLUMN "supportsToolUse" BOOLEAN NOT NULL DEFAULT false;

-- CreateIndex
CREATE UNIQUE INDEX "AgentActionProposal_proposalId_key" ON "AgentActionProposal"("proposalId");

-- CreateIndex
CREATE UNIQUE INDEX "AgentActionProposal_messageId_key" ON "AgentActionProposal"("messageId");

-- CreateIndex
CREATE INDEX "AgentActionProposal_threadId_idx" ON "AgentActionProposal"("threadId");

-- CreateIndex
CREATE INDEX "AgentActionProposal_status_idx" ON "AgentActionProposal"("status");

-- CreateIndex
CREATE UNIQUE INDEX "ApiToken_token_key" ON "ApiToken"("token");

-- AddForeignKey
ALTER TABLE "AgentActionProposal" ADD CONSTRAINT "AgentActionProposal_threadId_fkey" FOREIGN KEY ("threadId") REFERENCES "AgentThread"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AgentActionProposal" ADD CONSTRAINT "AgentActionProposal_messageId_fkey" FOREIGN KEY ("messageId") REFERENCES "AgentMessage"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AgentActionProposal" ADD CONSTRAINT "AgentActionProposal_decidedById_fkey" FOREIGN KEY ("decidedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ApiToken" ADD CONSTRAINT "ApiToken_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
