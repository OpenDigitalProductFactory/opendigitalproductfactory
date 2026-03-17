-- AlterTable: add submitter and completion tracking to BacklogItem
ALTER TABLE "BacklogItem" ADD COLUMN IF NOT EXISTS "submittedById" TEXT;
ALTER TABLE "BacklogItem" ADD COLUMN IF NOT EXISTS "completedAt" TIMESTAMP(3);

-- AddForeignKey
ALTER TABLE "BacklogItem" ADD CONSTRAINT "BacklogItem_submittedById_fkey" FOREIGN KEY ("submittedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
