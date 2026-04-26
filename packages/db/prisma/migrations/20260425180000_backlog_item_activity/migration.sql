-- CreateTable
CREATE TABLE "BacklogItemActivity" (
    "id" TEXT NOT NULL,
    "backlogItemId" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "summary" TEXT NOT NULL,
    "payload" JSONB NOT NULL DEFAULT '{}',
    "recordedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "recordedById" TEXT,
    "recordedByAgentId" TEXT,
    "toolExecutionId" TEXT,

    CONSTRAINT "BacklogItemActivity_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "BacklogItemActivity_backlogItemId_recordedAt_idx" ON "BacklogItemActivity"("backlogItemId", "recordedAt" DESC);

-- CreateIndex
CREATE INDEX "BacklogItemActivity_kind_recordedAt_idx" ON "BacklogItemActivity"("kind", "recordedAt" DESC);

-- AddForeignKey
ALTER TABLE "BacklogItemActivity" ADD CONSTRAINT "BacklogItemActivity_backlogItemId_fkey" FOREIGN KEY ("backlogItemId") REFERENCES "BacklogItem"("id") ON DELETE CASCADE ON UPDATE CASCADE;
