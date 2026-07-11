-- @migration-safety: data-safe: additive nullable columns (workCapsuleId, executorKind, recordedByPrincipalId, recordedByAgentId) plus one index and one FK with ON DELETE SET NULL. No column drops, no NOT NULL added to existing rows, no data backfill. The FK column is brand-new and all-NULL, so constraint validation is trivial and non-locking in practice.
--
-- EP-WORK-CONVERGENCE Phase 1 (BI-D6FA8641): bind external evidence to the durable
-- WorkCapsule with producer identity. Removing a capsule never deletes evidence history.

-- AlterTable
ALTER TABLE "ExternalEvidenceRecord" ADD COLUMN     "executorKind" TEXT,
ADD COLUMN     "recordedByAgentId" TEXT,
ADD COLUMN     "recordedByPrincipalId" TEXT,
ADD COLUMN     "workCapsuleId" TEXT;

-- CreateIndex
CREATE INDEX "ExternalEvidenceRecord_workCapsuleId_createdAt_idx" ON "ExternalEvidenceRecord"("workCapsuleId", "createdAt");

-- AddForeignKey
ALTER TABLE "ExternalEvidenceRecord" ADD CONSTRAINT "ExternalEvidenceRecord_workCapsuleId_fkey" FOREIGN KEY ("workCapsuleId") REFERENCES "WorkCapsule"("id") ON DELETE SET NULL ON UPDATE CASCADE;
