CREATE TABLE "AgentAttachment" (
    "id" TEXT NOT NULL,
    "threadId" TEXT NOT NULL,
    "messageId" TEXT,
    "fileName" TEXT NOT NULL,
    "mimeType" TEXT NOT NULL,
    "sizeBytes" INTEGER NOT NULL,
    "storageKey" TEXT NOT NULL,
    "parsedContent" JSONB,
    "parsedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "AgentAttachment_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "AgentAttachment_threadId_idx" ON "AgentAttachment"("threadId");
CREATE INDEX "AgentAttachment_messageId_idx" ON "AgentAttachment"("messageId");
ALTER TABLE "AgentAttachment" ADD CONSTRAINT "AgentAttachment_threadId_fkey" FOREIGN KEY ("threadId") REFERENCES "AgentThread"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "AgentAttachment" ADD CONSTRAINT "AgentAttachment_messageId_fkey" FOREIGN KEY ("messageId") REFERENCES "AgentMessage"("id") ON DELETE SET NULL ON UPDATE CASCADE;
