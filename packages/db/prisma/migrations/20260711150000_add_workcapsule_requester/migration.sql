-- @migration-safety: data-safe: additive nullable column requestedByPrincipalId + one index on WorkCapsule. No drops, no NOT NULL on existing rows, no backfill.
-- EP-WORK-CONVERGENCE (BI-B24F96D0): first-class Requester on the WorkCapsule.

-- AlterTable
ALTER TABLE "WorkCapsule" ADD COLUMN     "requestedByPrincipalId" TEXT;
-- CreateIndex
CREATE INDEX "WorkCapsule_requestedByPrincipalId_idx" ON "WorkCapsule"("requestedByPrincipalId");
