CREATE TABLE "SelfUpgradeRun" (
  "id" TEXT NOT NULL,
  "runId" TEXT NOT NULL,
  "status" TEXT NOT NULL DEFAULT 'queued',
  "trigger" TEXT NOT NULL,
  "currentSha" TEXT,
  "targetSha" TEXT,
  "deployedSha" TEXT,
  "reason" TEXT,
  "promoterContainerName" TEXT,
  "completionEvidence" JSONB,
  "failureLog" TEXT,
  "startedAt" TIMESTAMP(3),
  "completedAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "SelfUpgradeRun_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "SelfUpgradeRun_runId_key" ON "SelfUpgradeRun"("runId");
CREATE INDEX "SelfUpgradeRun_status_createdAt_idx" ON "SelfUpgradeRun"("status", "createdAt");
CREATE INDEX "SelfUpgradeRun_targetSha_idx" ON "SelfUpgradeRun"("targetSha");
