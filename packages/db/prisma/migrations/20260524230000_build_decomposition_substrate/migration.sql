-- Build Studio design-time decomposition — Phase 1 substrate.
-- Spec: docs/superpowers/specs/2026-05-24-build-studio-design-time-decomposition-design.md
-- BI: BI-2E6CC391
--
-- All changes additive; no destructive operations. Existing FeatureBuilds and
-- Epics work unchanged. New nullable columns + new FeatureBuildDependency table.

-- AlterTable
ALTER TABLE "BacklogItem" ADD COLUMN     "activeEpicId" TEXT;

-- AlterTable
ALTER TABLE "Epic" ADD COLUMN     "decompositionState" JSONB,
ADD COLUMN     "designDoc" JSONB,
ADD COLUMN     "designReview" JSONB,
ADD COLUMN     "originatingBacklogItemId" TEXT;

-- AlterTable
ALTER TABLE "FeatureBuild" ADD COLUMN     "childOrder" INTEGER,
ADD COLUMN     "parentEpicId" TEXT,
ADD COLUMN     "supersededByEpicId" TEXT;

-- CreateTable
CREATE TABLE "FeatureBuildDependency" (
    "id" TEXT NOT NULL,
    "dependentBuildId" TEXT NOT NULL,
    "dependsOnBuildId" TEXT NOT NULL,
    "parentEpicId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "FeatureBuildDependency_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "FeatureBuildDependency_parentEpicId_idx" ON "FeatureBuildDependency"("parentEpicId");

-- CreateIndex
CREATE INDEX "FeatureBuildDependency_dependsOnBuildId_idx" ON "FeatureBuildDependency"("dependsOnBuildId");

-- CreateIndex
CREATE UNIQUE INDEX "FeatureBuildDependency_dependentBuildId_dependsOnBuildId_key" ON "FeatureBuildDependency"("dependentBuildId", "dependsOnBuildId");

-- CreateIndex
CREATE UNIQUE INDEX "BacklogItem_activeEpicId_key" ON "BacklogItem"("activeEpicId");

-- CreateIndex
CREATE UNIQUE INDEX "Epic_originatingBacklogItemId_key" ON "Epic"("originatingBacklogItemId");

-- CreateIndex
CREATE INDEX "Epic_originatingBacklogItemId_idx" ON "Epic"("originatingBacklogItemId");

-- CreateIndex
CREATE INDEX "FeatureBuild_parentEpicId_childOrder_idx" ON "FeatureBuild"("parentEpicId", "childOrder");

-- CreateIndex
CREATE INDEX "FeatureBuild_supersededByEpicId_idx" ON "FeatureBuild"("supersededByEpicId");

-- AddForeignKey
ALTER TABLE "BacklogItem" ADD CONSTRAINT "BacklogItem_activeEpicId_fkey" FOREIGN KEY ("activeEpicId") REFERENCES "Epic"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Epic" ADD CONSTRAINT "Epic_originatingBacklogItemId_fkey" FOREIGN KEY ("originatingBacklogItemId") REFERENCES "BacklogItem"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FeatureBuild" ADD CONSTRAINT "FeatureBuild_parentEpicId_fkey" FOREIGN KEY ("parentEpicId") REFERENCES "Epic"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FeatureBuild" ADD CONSTRAINT "FeatureBuild_supersededByEpicId_fkey" FOREIGN KEY ("supersededByEpicId") REFERENCES "Epic"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FeatureBuildDependency" ADD CONSTRAINT "FeatureBuildDependency_dependentBuildId_fkey" FOREIGN KEY ("dependentBuildId") REFERENCES "FeatureBuild"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FeatureBuildDependency" ADD CONSTRAINT "FeatureBuildDependency_dependsOnBuildId_fkey" FOREIGN KEY ("dependsOnBuildId") REFERENCES "FeatureBuild"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FeatureBuildDependency" ADD CONSTRAINT "FeatureBuildDependency_parentEpicId_fkey" FOREIGN KEY ("parentEpicId") REFERENCES "Epic"("id") ON DELETE CASCADE ON UPDATE CASCADE;
