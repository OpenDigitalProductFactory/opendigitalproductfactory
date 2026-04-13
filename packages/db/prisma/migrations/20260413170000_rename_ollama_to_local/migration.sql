-- EP-AGENT-CAP-002-CLEANUP: Rename Docker Model Runner provider from "ollama" to "local".
-- If "local" already exists (seeded before this migration runs), this is a no-op.
-- The orphaned "ollama" records remain and are ignored by the application.
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM "ModelProvider" WHERE "providerId" = 'local') THEN
    UPDATE "ModelProfile" SET "providerId" = 'local' WHERE "providerId" = 'ollama';
    UPDATE "DiscoveredModel" SET "providerId" = 'local' WHERE "providerId" = 'ollama';
    UPDATE "AgentModelConfig" SET "pinnedProviderId" = 'local' WHERE "pinnedProviderId" = 'ollama';
    UPDATE "ModelProvider" SET "providerId" = 'local' WHERE "providerId" = 'ollama';
  END IF;
END $$;
