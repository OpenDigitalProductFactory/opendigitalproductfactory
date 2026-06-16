-- Link every SelfUpgradeRun to the change-management record (RFC) it is
-- registered as. Optional + unique: a self-upgrade opens at most one change
-- record, and no-op skipped ticks open none. ON DELETE SET NULL keeps run
-- history if a change record is ever purged.

-- AlterTable
ALTER TABLE "SelfUpgradeRun" ADD COLUMN "changeRequestId" TEXT;

-- CreateIndex
CREATE UNIQUE INDEX "SelfUpgradeRun_changeRequestId_key" ON "SelfUpgradeRun"("changeRequestId");

-- AddForeignKey
ALTER TABLE "SelfUpgradeRun" ADD CONSTRAINT "SelfUpgradeRun_changeRequestId_fkey" FOREIGN KEY ("changeRequestId") REFERENCES "ChangeRequest"("id") ON DELETE SET NULL ON UPDATE CASCADE;
