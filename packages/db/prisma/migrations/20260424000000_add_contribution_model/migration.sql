-- AlterTable
ALTER TABLE "PlatformDevConfig" ADD COLUMN     "contributionModel" TEXT,
ADD COLUMN     "contributorForkOwner" TEXT,
ADD COLUMN     "contributorForkRepo" TEXT,
ADD COLUMN     "forkVerifiedAt" TIMESTAMP(3);
