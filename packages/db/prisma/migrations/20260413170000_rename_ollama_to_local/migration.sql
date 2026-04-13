-- EP-AGENT-CAP-002-CLEANUP: Rename Docker Model Runner provider from "ollama" to "local".
-- Handles two cases:
--   (a) Only "ollama" exists → rename it to "local"
--   (b) Both "ollama" and "local" exist (seed ran first) → remove stale "ollama" records
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM "ModelProvider" WHERE "providerId" = 'local') THEN
    -- Case (b): "local" already seeded. Delete stale "ollama" records (children first).
    DELETE FROM "ModelProfile" WHERE "providerId" = 'ollama';
    DELETE FROM "DiscoveredModel" WHERE "providerId" = 'ollama';
    UPDATE "AgentModelConfig" SET "pinnedProviderId" = NULL WHERE "pinnedProviderId" = 'ollama';
    DELETE FROM "ModelProvider" WHERE "providerId" = 'ollama';
  ELSE
    -- Case (a): Only "ollama" exists. Rename to "local" (children first).
    UPDATE "ModelProfile" SET "providerId" = 'local' WHERE "providerId" = 'ollama';
    UPDATE "DiscoveredModel" SET "providerId" = 'local' WHERE "providerId" = 'ollama';
    UPDATE "AgentModelConfig" SET "pinnedProviderId" = 'local' WHERE "pinnedProviderId" = 'ollama';
    UPDATE "ModelProvider" SET "providerId" = 'local' WHERE "providerId" = 'ollama';
  END IF;
END $$;
