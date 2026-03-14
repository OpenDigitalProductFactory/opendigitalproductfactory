-- CreateTable
CREATE TABLE "PlatformIssueReport" (
    "id" TEXT NOT NULL,
    "reportId" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "severity" TEXT NOT NULL DEFAULT 'medium',
    "status" TEXT NOT NULL DEFAULT 'open',
    "title" TEXT NOT NULL,
    "description" TEXT,
    "routeContext" TEXT,
    "errorStack" TEXT,
    "userAgent" TEXT,
    "reportedById" TEXT,
    "digitalProductId" TEXT,
    "portfolioId" TEXT,
    "agentId" TEXT,
    "source" TEXT NOT NULL DEFAULT 'manual',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PlatformIssueReport_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "PlatformIssueReport_reportId_key" ON "PlatformIssueReport"("reportId");

-- AddForeignKey
ALTER TABLE "PlatformIssueReport" ADD CONSTRAINT "PlatformIssueReport_reportedById_fkey" FOREIGN KEY ("reportedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
