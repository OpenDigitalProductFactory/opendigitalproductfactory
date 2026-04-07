-- Add stable anonymous client identity to PlatformDevConfig
-- clientId: UUID generated once at install, never regenerated
-- gitAgentEmail: agent-<sha256(clientId)[:16]>@hive.dpf
ALTER TABLE "PlatformDevConfig" ADD COLUMN IF NOT EXISTS "clientId" TEXT;
ALTER TABLE "PlatformDevConfig" ADD COLUMN IF NOT EXISTS "gitAgentEmail" TEXT;
