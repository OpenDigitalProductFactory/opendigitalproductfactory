-- @migration-safety: data-safe: additive nullable column workItemId + one index + a SET NULL foreign key on WorkCapsule. No drops, no NOT NULL on existing rows, no backfill; deleting the linked WorkItem nulls the column rather than cascading.
-- EP-WORK-CONVERGENCE (BI-650994D7): canonical WorkItem anchor — a WorkCapsule points at the one WorkItem for its unit of work, so capsule and case never split into two rows for one job.

-- AlterTable
ALTER TABLE "WorkCapsule" ADD COLUMN     "workItemId" TEXT;

-- CreateIndex
CREATE INDEX "WorkCapsule_workItemId_idx" ON "WorkCapsule"("workItemId");

-- AddForeignKey
ALTER TABLE "WorkCapsule" ADD CONSTRAINT "WorkCapsule_workItemId_fkey" FOREIGN KEY ("workItemId") REFERENCES "WorkItem"("id") ON DELETE SET NULL ON UPDATE CASCADE;
