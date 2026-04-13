-- EP-AGENT-CAP-002-CLEANUP: Rename Docker Model Runner provider from "ollama" to "local".
-- Child tables updated before the parent (FK constraints).
UPDATE "ModelProfile" SET "providerId" = 'local' WHERE "providerId" = 'ollama';
UPDATE "DiscoveredModel" SET "providerId" = 'local' WHERE "providerId" = 'ollama';
UPDATE "AgentModelConfig" SET "pinnedProviderId" = 'local' WHERE "pinnedProviderId" = 'ollama';
UPDATE "ModelProvider" SET "providerId" = 'local' WHERE "providerId" = 'ollama';
