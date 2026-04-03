-- EP-AI-WORKFORCE-001 Phase 6: Remove deprecated Agent.preferredProviderId
-- Provider pinning is now exclusively via AgentModelConfig.pinnedProviderId

-- Migrate any existing preferredProviderId values to AgentModelConfig
-- (only for agents that have a preferredProviderId but no pinnedProviderId in AgentModelConfig)
INSERT INTO "AgentModelConfig" ("agentId", "minimumTier", "budgetClass", "pinnedProviderId", "configuredAt")
SELECT a."agentId", 'adequate', 'balanced', a."preferredProviderId", NOW()
FROM "Agent" a
WHERE a."preferredProviderId" IS NOT NULL
  AND NOT EXISTS (
    SELECT 1 FROM "AgentModelConfig" amc WHERE amc."agentId" = a."agentId"
  )
ON CONFLICT ("agentId") DO NOTHING;

-- Update existing AgentModelConfig rows that lack a pinnedProviderId
UPDATE "AgentModelConfig" amc
SET "pinnedProviderId" = a."preferredProviderId"
FROM "Agent" a
WHERE amc."agentId" = a."agentId"
  AND a."preferredProviderId" IS NOT NULL
  AND amc."pinnedProviderId" IS NULL;

-- Drop the column
ALTER TABLE "Agent" DROP COLUMN "preferredProviderId";
