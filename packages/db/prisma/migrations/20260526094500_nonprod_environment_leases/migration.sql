-- Create governed nonproduction environment leases for shared localhost resources.
CREATE TABLE "NonProductionEnvironmentLease" (
  "id" TEXT NOT NULL,
  "leaseId" TEXT NOT NULL,
  "environmentKey" TEXT NOT NULL,
  "status" TEXT NOT NULL DEFAULT 'active',
  "ownerProvider" TEXT NOT NULL,
  "ownerSessionId" TEXT NOT NULL,
  "purpose" TEXT NOT NULL,
  "worktreePath" TEXT,
  "branchName" TEXT,
  "buildId" TEXT,
  "taskRunId" TEXT,
  "url" TEXT NOT NULL,
  "ports" INTEGER[] NOT NULL DEFAULT ARRAY[]::INTEGER[],
  "cleanupCommand" TEXT,
  "evidenceRecordId" TEXT,
  "expiresAt" TIMESTAMP(3) NOT NULL,
  "releasedAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,

  CONSTRAINT "NonProductionEnvironmentLease_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "NonProductionEnvironmentLease_leaseId_key" ON "NonProductionEnvironmentLease"("leaseId");
CREATE INDEX "NonProductionEnvironmentLease_environmentKey_status_idx" ON "NonProductionEnvironmentLease"("environmentKey", "status");
CREATE INDEX "NonProductionEnvironmentLease_ownerProvider_ownerSessionId_idx" ON "NonProductionEnvironmentLease"("ownerProvider", "ownerSessionId");
CREATE INDEX "NonProductionEnvironmentLease_buildId_createdAt_idx" ON "NonProductionEnvironmentLease"("buildId", "createdAt");
CREATE INDEX "NonProductionEnvironmentLease_taskRunId_createdAt_idx" ON "NonProductionEnvironmentLease"("taskRunId", "createdAt");
CREATE INDEX "NonProductionEnvironmentLease_expiresAt_idx" ON "NonProductionEnvironmentLease"("expiresAt");
