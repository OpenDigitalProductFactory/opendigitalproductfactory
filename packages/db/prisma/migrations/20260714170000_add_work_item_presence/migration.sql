-- @migration-safety: data-safe: new table WorkItemPresence + its index/unique/FK only. No changes to existing tables, no drops, no data backfill.
-- BI-B416B12A: work-item presence.

-- CreateTable
CREATE TABLE "WorkItemPresence" (
    "id" TEXT NOT NULL,
    "workItemId" TEXT NOT NULL,
    "principalType" TEXT NOT NULL,
    "principalId" TEXT NOT NULL,
    "displayLabel" TEXT,
    "lastSeenAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "WorkItemPresence_pkey" PRIMARY KEY ("id")
);
-- CreateIndex
CREATE INDEX "WorkItemPresence_workItemId_lastSeenAt_idx" ON "WorkItemPresence"("workItemId", "lastSeenAt");
-- CreateIndex
CREATE UNIQUE INDEX "WorkItemPresence_workItemId_principalType_principalId_key" ON "WorkItemPresence"("workItemId", "principalType", "principalId");
-- AddForeignKey
ALTER TABLE "WorkItemPresence" ADD CONSTRAINT "WorkItemPresence_workItemId_fkey" FOREIGN KEY ("workItemId") REFERENCES "WorkItem"("id") ON DELETE CASCADE ON UPDATE CASCADE;
