-- CreateTable
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

-- AddForeignKey
ALTER TABLE "AgentModelConfig" ADD CONSTRAINT "AgentModelConfig_configuredById_fkey" FOREIGN KEY ("configuredById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
