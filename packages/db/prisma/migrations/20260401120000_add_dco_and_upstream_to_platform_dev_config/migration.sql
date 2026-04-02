-- AlterTable
ALTER TABLE "PlatformDevConfig" ADD COLUMN "dcoAcceptedAt" TIMESTAMP(3);
ALTER TABLE "PlatformDevConfig" ADD COLUMN "dcoAcceptedById" TEXT;
ALTER TABLE "PlatformDevConfig" ADD COLUMN "upstreamRemoteUrl" TEXT;

-- AddForeignKey
ALTER TABLE "PlatformDevConfig" ADD CONSTRAINT "PlatformDevConfig_dcoAcceptedById_fkey" FOREIGN KEY ("dcoAcceptedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
