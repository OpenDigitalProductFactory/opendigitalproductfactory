-- AlterTable
ALTER TABLE "AgentMessage" ADD COLUMN     "agentId" TEXT,
ADD COLUMN     "routeContext" TEXT;

-- AlterTable
ALTER TABLE "AgentThread" ALTER COLUMN "contextKey" SET DEFAULT 'coworker';

-- CreateIndex
CREATE INDEX "AgentMessage_threadId_idx" ON "AgentMessage"("threadId");

-- CreateIndex
CREATE INDEX "AgentMessage_createdAt_idx" ON "AgentMessage"("createdAt");

DO $$
BEGIN
    IF EXISTS (
        SELECT 1
        FROM pg_class
        WHERE relkind = 'i'
          AND relname = 'InventoryRelationship_fromEntityId_toEntityId_relationshipType_'
    ) THEN
        ALTER INDEX "InventoryRelationship_fromEntityId_toEntityId_relationshipType_" RENAME TO "InventoryRelationship_fromEntityId_toEntityId_relationshipT_key";
    END IF;
END $$;
