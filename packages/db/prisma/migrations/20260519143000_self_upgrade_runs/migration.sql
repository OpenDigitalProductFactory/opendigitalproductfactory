-- CreateTable
CREATE TABLE "SelfUpgradeRun" (
    "id" TEXT NOT NULL,
    "runId" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'pending',
    "triggeredBy" TEXT,
    "fromVersion" TEXT,
    "toVersion" TEXT,
    "startedAt" TIMESTAMP(3),
    "completedAt" TIMESTAMP(3),
    "error" TEXT,
    "log" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "SelfUpgradeRun_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "SelfUpgradeRun_runId_key" ON "SelfUpgradeRun"("runId");
CREATE INDEX "SelfUpgradeRun_status_idx" ON "SelfUpgradeRun"("status");
CREATE INDEX "SelfUpgradeRun_createdAt_idx" ON "SelfUpgradeRun"("createdAt");

-- Seed default portal.selfUpgrade config for existing installs (idempotent).
INSERT INTO "PlatformConfig" ("id", "key", "value", "updatedAt")
VALUES (
    gen_random_uuid()::text,
    'portal.selfUpgrade',
    '{"enabled":false,"channel":"stable","checkIntervalHours":24}',
    NOW()
)
ON CONFLICT ("key") DO NOTHING;
