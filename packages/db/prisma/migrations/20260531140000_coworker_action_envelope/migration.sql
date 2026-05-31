-- Pseudo-User Contract — Phase 1 substrate (spec §6.4 + §6.5 + §8).
-- Adds the CoworkerActionEnvelope table for destructive-action proposals
-- and three nullable columns on ToolExecution for dual-principal audit +
-- envelope back-reference. Backfill not required: new columns are nullable
-- and only populated for executions/proposals created after this migration.
-- BI-D887CD3B / EP-COWORKER-INTERACTIVITY.

-- CreateTable
CREATE TABLE "CoworkerActionEnvelope" (
    "id" TEXT NOT NULL,
    "coworkerAgentId" TEXT NOT NULL,
    "delegatingUserId" TEXT NOT NULL,
    "threadId" TEXT NOT NULL,
    "chatMessageId" TEXT,
    "manifestActionId" TEXT NOT NULL,
    "argsJson" JSONB NOT NULL,
    "rationale" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'proposed',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "resolvedAt" TIMESTAMP(3),

    CONSTRAINT "CoworkerActionEnvelope_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "CoworkerActionEnvelope_threadId_createdAt_idx" ON "CoworkerActionEnvelope"("threadId", "createdAt" DESC);

-- CreateIndex
CREATE INDEX "CoworkerActionEnvelope_coworkerAgentId_createdAt_idx" ON "CoworkerActionEnvelope"("coworkerAgentId", "createdAt" DESC);

-- CreateIndex
CREATE INDEX "CoworkerActionEnvelope_status_idx" ON "CoworkerActionEnvelope"("status");

-- CreateIndex
CREATE INDEX "CoworkerActionEnvelope_chatMessageId_idx" ON "CoworkerActionEnvelope"("chatMessageId");

-- AlterTable
ALTER TABLE "ToolExecution" ADD COLUMN "delegatingUserId" TEXT;
ALTER TABLE "ToolExecution" ADD COLUMN "chatMessageId" TEXT;
ALTER TABLE "ToolExecution" ADD COLUMN "envelopeId" TEXT;

-- CreateIndex
CREATE INDEX "ToolExecution_envelopeId_idx" ON "ToolExecution"("envelopeId");

-- CreateIndex
CREATE INDEX "ToolExecution_delegatingUserId_createdAt_idx" ON "ToolExecution"("delegatingUserId", "createdAt" DESC);

-- AddForeignKey
ALTER TABLE "CoworkerActionEnvelope" ADD CONSTRAINT "CoworkerActionEnvelope_delegatingUserId_fkey" FOREIGN KEY ("delegatingUserId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CoworkerActionEnvelope" ADD CONSTRAINT "CoworkerActionEnvelope_threadId_fkey" FOREIGN KEY ("threadId") REFERENCES "AgentThread"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CoworkerActionEnvelope" ADD CONSTRAINT "CoworkerActionEnvelope_chatMessageId_fkey" FOREIGN KEY ("chatMessageId") REFERENCES "AgentMessage"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ToolExecution" ADD CONSTRAINT "ToolExecution_envelopeId_fkey" FOREIGN KEY ("envelopeId") REFERENCES "CoworkerActionEnvelope"("id") ON DELETE SET NULL ON UPDATE CASCADE;
