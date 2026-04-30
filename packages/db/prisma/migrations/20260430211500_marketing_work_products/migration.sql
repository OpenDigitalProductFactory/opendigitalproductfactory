CREATE TABLE IF NOT EXISTS "MarketingCampaignBrief" (
    "briefId" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "strategyId" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "objective" TEXT NOT NULL,
    "audience" TEXT,
    "channels" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
    "cta" TEXT,
    "proofAssets" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
    "kpis" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
    "notes" TEXT,
    "status" TEXT NOT NULL DEFAULT 'draft',
    "createdByAgentId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "MarketingCampaignBrief_pkey" PRIMARY KEY ("briefId")
);

CREATE TABLE IF NOT EXISTS "MarketingAssetTask" (
    "taskId" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "strategyId" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "assetType" TEXT NOT NULL,
    "channel" TEXT,
    "dueWindow" TEXT,
    "brief" TEXT,
    "status" TEXT NOT NULL DEFAULT 'draft',
    "createdByAgentId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "MarketingAssetTask_pkey" PRIMARY KEY ("taskId")
);

CREATE TABLE IF NOT EXISTS "MarketingKpiCheckpoint" (
    "checkpointId" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "strategyId" TEXT NOT NULL,
    "metric" TEXT NOT NULL,
    "target" TEXT,
    "cadence" TEXT,
    "notes" TEXT,
    "status" TEXT NOT NULL DEFAULT 'active',
    "createdByAgentId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "MarketingKpiCheckpoint_pkey" PRIMARY KEY ("checkpointId")
);

CREATE TABLE IF NOT EXISTS "MarketingAutomationCandidate" (
    "candidateId" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "strategyId" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "trigger" TEXT NOT NULL,
    "action" TEXT NOT NULL,
    "approvalRequired" BOOLEAN NOT NULL DEFAULT true,
    "rationale" TEXT,
    "status" TEXT NOT NULL DEFAULT 'draft',
    "createdByAgentId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "MarketingAutomationCandidate_pkey" PRIMARY KEY ("candidateId")
);

CREATE INDEX IF NOT EXISTS "MarketingCampaignBrief_organizationId_createdAt_idx" ON "MarketingCampaignBrief"("organizationId", "createdAt");
CREATE INDEX IF NOT EXISTS "MarketingCampaignBrief_strategyId_createdAt_idx" ON "MarketingCampaignBrief"("strategyId", "createdAt");
CREATE INDEX IF NOT EXISTS "MarketingCampaignBrief_status_idx" ON "MarketingCampaignBrief"("status");

CREATE INDEX IF NOT EXISTS "MarketingAssetTask_organizationId_createdAt_idx" ON "MarketingAssetTask"("organizationId", "createdAt");
CREATE INDEX IF NOT EXISTS "MarketingAssetTask_strategyId_createdAt_idx" ON "MarketingAssetTask"("strategyId", "createdAt");
CREATE INDEX IF NOT EXISTS "MarketingAssetTask_status_idx" ON "MarketingAssetTask"("status");

CREATE INDEX IF NOT EXISTS "MarketingKpiCheckpoint_organizationId_createdAt_idx" ON "MarketingKpiCheckpoint"("organizationId", "createdAt");
CREATE INDEX IF NOT EXISTS "MarketingKpiCheckpoint_strategyId_createdAt_idx" ON "MarketingKpiCheckpoint"("strategyId", "createdAt");
CREATE INDEX IF NOT EXISTS "MarketingKpiCheckpoint_metric_idx" ON "MarketingKpiCheckpoint"("metric");

CREATE INDEX IF NOT EXISTS "MarketingAutomationCandidate_organizationId_createdAt_idx" ON "MarketingAutomationCandidate"("organizationId", "createdAt");
CREATE INDEX IF NOT EXISTS "MarketingAutomationCandidate_strategyId_createdAt_idx" ON "MarketingAutomationCandidate"("strategyId", "createdAt");
CREATE INDEX IF NOT EXISTS "MarketingAutomationCandidate_status_idx" ON "MarketingAutomationCandidate"("status");

DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint WHERE conname = 'MarketingCampaignBrief_organizationId_fkey'
    ) THEN
        ALTER TABLE "MarketingCampaignBrief" ADD CONSTRAINT "MarketingCampaignBrief_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;
    END IF;
END $$;

DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint WHERE conname = 'MarketingCampaignBrief_strategyId_fkey'
    ) THEN
        ALTER TABLE "MarketingCampaignBrief" ADD CONSTRAINT "MarketingCampaignBrief_strategyId_fkey" FOREIGN KEY ("strategyId") REFERENCES "MarketingStrategy"("strategyId") ON DELETE CASCADE ON UPDATE CASCADE;
    END IF;
END $$;

DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint WHERE conname = 'MarketingAssetTask_organizationId_fkey'
    ) THEN
        ALTER TABLE "MarketingAssetTask" ADD CONSTRAINT "MarketingAssetTask_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;
    END IF;
END $$;

DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint WHERE conname = 'MarketingAssetTask_strategyId_fkey'
    ) THEN
        ALTER TABLE "MarketingAssetTask" ADD CONSTRAINT "MarketingAssetTask_strategyId_fkey" FOREIGN KEY ("strategyId") REFERENCES "MarketingStrategy"("strategyId") ON DELETE CASCADE ON UPDATE CASCADE;
    END IF;
END $$;

DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint WHERE conname = 'MarketingKpiCheckpoint_organizationId_fkey'
    ) THEN
        ALTER TABLE "MarketingKpiCheckpoint" ADD CONSTRAINT "MarketingKpiCheckpoint_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;
    END IF;
END $$;

DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint WHERE conname = 'MarketingKpiCheckpoint_strategyId_fkey'
    ) THEN
        ALTER TABLE "MarketingKpiCheckpoint" ADD CONSTRAINT "MarketingKpiCheckpoint_strategyId_fkey" FOREIGN KEY ("strategyId") REFERENCES "MarketingStrategy"("strategyId") ON DELETE CASCADE ON UPDATE CASCADE;
    END IF;
END $$;

DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint WHERE conname = 'MarketingAutomationCandidate_organizationId_fkey'
    ) THEN
        ALTER TABLE "MarketingAutomationCandidate" ADD CONSTRAINT "MarketingAutomationCandidate_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;
    END IF;
END $$;

DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint WHERE conname = 'MarketingAutomationCandidate_strategyId_fkey'
    ) THEN
        ALTER TABLE "MarketingAutomationCandidate" ADD CONSTRAINT "MarketingAutomationCandidate_strategyId_fkey" FOREIGN KEY ("strategyId") REFERENCES "MarketingStrategy"("strategyId") ON DELETE CASCADE ON UPDATE CASCADE;
    END IF;
END $$;
