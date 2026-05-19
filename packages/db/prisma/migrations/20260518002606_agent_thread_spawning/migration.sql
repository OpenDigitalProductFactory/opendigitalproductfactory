-- AlterTable
ALTER TABLE "AgentThread" ADD COLUMN     "cancelledAt" TIMESTAMP(3),
ADD COLUMN     "childCount" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "idempotencyKey" TEXT,
ADD COLUMN     "parentThreadId" TEXT,
ADD COLUMN     "terminalError" JSONB;

-- CreateIndex
CREATE INDEX "AgentThread_parentThreadId_idx" ON "AgentThread"("parentThreadId");

-- AddForeignKey
ALTER TABLE "AgentThread" ADD CONSTRAINT "AgentThread_parentThreadId_fkey" FOREIGN KEY ("parentThreadId") REFERENCES "AgentThread"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
