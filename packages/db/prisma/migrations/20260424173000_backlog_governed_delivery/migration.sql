-- AlterTable
ALTER TABLE "BacklogItem" ADD COLUMN     "abandonReason" TEXT,
ADD COLUMN     "activeBuildId" TEXT,
ADD COLUMN     "duplicateOfId" TEXT,
ADD COLUMN     "effortSize" TEXT,
ADD COLUMN     "proposedOutcome" TEXT,
ADD COLUMN     "resolution" TEXT,
ADD COLUMN     "stalenessDetectedAt" TIMESTAMP(3),
ADD COLUMN     "triageOutcome" TEXT;

-- AlterTable
ALTER TABLE "FeatureBuild" ADD COLUMN     "abandonReason" TEXT,
ADD COLUMN     "abandonedAt" TIMESTAMP(3),
ADD COLUMN     "draftApprovedAt" TIMESTAMP(3),
ADD COLUMN     "originatingBacklogItemId" TEXT;

-- AlterTable
ALTER TABLE "PlatformDevConfig" ADD COLUMN     "backlogTeeUpDailyCap" INTEGER NOT NULL DEFAULT 3,
ADD COLUMN     "governedBacklogEnabled" BOOLEAN NOT NULL DEFAULT false;

-- CreateIndex
CREATE UNIQUE INDEX "BacklogItem_activeBuildId_key" ON "BacklogItem"("activeBuildId");

-- CreateIndex
CREATE INDEX "FeatureBuild_originatingBacklogItemId_idx" ON "FeatureBuild"("originatingBacklogItemId");

-- AddForeignKey
ALTER TABLE "BacklogItem" ADD CONSTRAINT "BacklogItem_activeBuildId_fkey" FOREIGN KEY ("activeBuildId") REFERENCES "FeatureBuild"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BacklogItem" ADD CONSTRAINT "BacklogItem_duplicateOfId_fkey" FOREIGN KEY ("duplicateOfId") REFERENCES "BacklogItem"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FeatureBuild" ADD CONSTRAINT "FeatureBuild_originatingBacklogItemId_fkey" FOREIGN KEY ("originatingBacklogItemId") REFERENCES "BacklogItem"("id") ON DELETE SET NULL ON UPDATE CASCADE;
