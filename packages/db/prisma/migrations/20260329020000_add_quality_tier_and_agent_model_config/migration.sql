-- EP-INF-012: Model Routing Simplification — Tiers & Admin Control

-- 012-001: Add qualityTier field to ModelProfile
ALTER TABLE "ModelProfile" ADD COLUMN "qualityTier" TEXT;
ALTER TABLE "ModelProfile" ADD COLUMN "qualityTierSource" TEXT NOT NULL DEFAULT 'auto';

-- 012-003: AgentModelConfig — per-agent model assignment (admin-overridable)
CREATE TABLE "AgentModelConfig" (
    "agentId" TEXT NOT NULL,
    "minimumTier" TEXT NOT NULL DEFAULT 'adequate',
    "pinnedProviderId" TEXT,
    "pinnedModelId" TEXT,
    "budgetClass" TEXT NOT NULL DEFAULT 'balanced',
    "configuredAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "configuredById" TEXT,

    CONSTRAINT "AgentModelConfig_pkey" PRIMARY KEY ("agentId")
);

-- Foreign key: configuredBy → User
ALTER TABLE "AgentModelConfig" ADD CONSTRAINT "AgentModelConfig_configuredById_fkey"
    FOREIGN KEY ("configuredById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
