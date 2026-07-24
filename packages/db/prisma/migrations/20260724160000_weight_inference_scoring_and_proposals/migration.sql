-- BI-D88DFEEA Phase 1/3: gate-scoring capture + weight-adjustment proposal ledger.
-- @migration-safety: data-safe: only nullable columns and a new table are added; no existing row can violate these additions.

ALTER TABLE "DecisionInteraction"
  ADD COLUMN "scoredOptions" JSONB,
  ADD COLUMN "recommendedOptionId" TEXT,
  ADD COLUMN "chosenOptionId" TEXT;

CREATE TABLE "WeightAdjustmentProposal" (
    "id" TEXT NOT NULL,
    "proposalId" TEXT NOT NULL,
    "domainClass" TEXT NOT NULL,
    "profileId" TEXT NOT NULL,
    "axis" TEXT NOT NULL,
    "direction" TEXT NOT NULL,
    "consistency" DOUBLE PRECISION NOT NULL,
    "meanSeparation" DOUBLE PRECISION NOT NULL,
    "sampleSize" INTEGER NOT NULL,
    "entersAtConfidenceWeight" DOUBLE PRECISION NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'proposed',
    "ruledAt" TIMESTAMP(3),
    "ruledByUserId" TEXT,
    "rejectionReason" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "WeightAdjustmentProposal_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "WeightAdjustmentProposal_proposalId_key" ON "WeightAdjustmentProposal"("proposalId");
CREATE INDEX "WeightAdjustmentProposal_profileId_domainClass_status_idx" ON "WeightAdjustmentProposal"("profileId", "domainClass", "status");
CREATE INDEX "WeightAdjustmentProposal_status_createdAt_idx" ON "WeightAdjustmentProposal"("status", "createdAt");

ALTER TABLE "WeightAdjustmentProposal"
  ADD CONSTRAINT "WeightAdjustmentProposal_profileId_fkey"
    FOREIGN KEY ("profileId") REFERENCES "DecisionPerspectiveProfile"("profileId") ON DELETE CASCADE ON UPDATE CASCADE,
  ADD CONSTRAINT "WeightAdjustmentProposal_ruledByUserId_fkey"
    FOREIGN KEY ("ruledByUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
