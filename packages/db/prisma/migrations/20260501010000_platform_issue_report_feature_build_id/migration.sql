-- Add featureBuildId FK to PlatformIssueReport so process-issue rows
-- written by the build-specialist operator-contract guards can be
-- attributed to the active FeatureBuild. Additive, nullable, low-risk.
--
-- Spec: docs/superpowers/specs/2026-04-30-build-specialist-operator-contract.md §5
-- Plan: docs/superpowers/plans/2026-04-30-build-specialist-operator-contract-slice-1.md Task 1

-- AlterTable
ALTER TABLE "PlatformIssueReport" ADD COLUMN "featureBuildId" TEXT;

-- CreateIndex
CREATE INDEX "PlatformIssueReport_featureBuildId_idx" ON "PlatformIssueReport"("featureBuildId");

-- AddForeignKey
ALTER TABLE "PlatformIssueReport" ADD CONSTRAINT "PlatformIssueReport_featureBuildId_fkey" FOREIGN KEY ("featureBuildId") REFERENCES "FeatureBuild"("id") ON DELETE SET NULL ON UPDATE CASCADE;
