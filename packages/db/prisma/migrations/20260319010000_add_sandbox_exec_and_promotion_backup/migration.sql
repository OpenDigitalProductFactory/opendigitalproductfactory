-- AlterTable: Add buildExecState to FeatureBuild
ALTER TABLE "FeatureBuild" ADD COLUMN "buildExecState" JSONB;

-- AlterTable: Add backupId to ChangePromotion
ALTER TABLE "ChangePromotion" ADD COLUMN "backupId" TEXT;

-- CreateTable: PromotionBackup
CREATE TABLE "PromotionBackup" (
    "id" TEXT NOT NULL,
    "buildId" TEXT NOT NULL,
    "timestamp" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "filePath" TEXT NOT NULL,
    "sizeBytes" INTEGER NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'complete',

    CONSTRAINT "PromotionBackup_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "PromotionBackup_buildId_idx" ON "PromotionBackup"("buildId");

-- AddForeignKey
ALTER TABLE "PromotionBackup" ADD CONSTRAINT "PromotionBackup_buildId_fkey" FOREIGN KEY ("buildId") REFERENCES "FeatureBuild"("buildId") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ChangePromotion" ADD CONSTRAINT "ChangePromotion_backupId_fkey" FOREIGN KEY ("backupId") REFERENCES "PromotionBackup"("id") ON DELETE SET NULL ON UPDATE CASCADE;
