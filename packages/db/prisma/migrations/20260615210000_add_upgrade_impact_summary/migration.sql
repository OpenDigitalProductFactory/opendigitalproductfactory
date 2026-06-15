-- Persist the self-upgrade "What's in this update?" impact summary so it
-- survives a page refresh AND the process restart every self-upgrade triggers,
-- and can be attached to the run the operator launches. Additive only:
-- a new table plus one nullable FK column on SelfUpgradeRun — existing rows
-- are unaffected.

-- CreateTable
CREATE TABLE "UpgradeImpactSummary" (
    "id" TEXT NOT NULL,
    "currentLineageSha" TEXT NOT NULL,
    "targetSha" TEXT NOT NULL,
    "summary" JSONB NOT NULL,
    "generatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "UpgradeImpactSummary_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "UpgradeImpactSummary_currentLineageSha_targetSha_key" ON "UpgradeImpactSummary"("currentLineageSha", "targetSha");

-- CreateIndex
CREATE INDEX "UpgradeImpactSummary_targetSha_idx" ON "UpgradeImpactSummary"("targetSha");

-- AlterTable
ALTER TABLE "SelfUpgradeRun" ADD COLUMN "impactSummaryId" TEXT;

-- CreateIndex
CREATE INDEX "SelfUpgradeRun_impactSummaryId_idx" ON "SelfUpgradeRun"("impactSummaryId");

-- AddForeignKey
ALTER TABLE "SelfUpgradeRun" ADD CONSTRAINT "SelfUpgradeRun_impactSummaryId_fkey" FOREIGN KEY ("impactSummaryId") REFERENCES "UpgradeImpactSummary"("id") ON DELETE SET NULL ON UPDATE CASCADE;
