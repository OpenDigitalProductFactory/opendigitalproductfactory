-- AlterTable
ALTER TABLE "BacklogItem" ADD COLUMN     "upstreamIssueNumber" INTEGER,
ADD COLUMN     "upstreamIssueUrl" TEXT,
ADD COLUMN     "upstreamSyncedAt" TIMESTAMP(3);

-- AlterTable
ALTER TABLE "Epic" ADD COLUMN     "upstreamIssueNumber" INTEGER,
ADD COLUMN     "upstreamIssueUrl" TEXT,
ADD COLUMN     "upstreamSyncedAt" TIMESTAMP(3);

-- AlterTable
ALTER TABLE "PlatformIssueReport" ADD COLUMN     "upstreamIssueNumber" INTEGER,
ADD COLUMN     "upstreamIssueUrl" TEXT,
ADD COLUMN     "upstreamSyncedAt" TIMESTAMP(3);
