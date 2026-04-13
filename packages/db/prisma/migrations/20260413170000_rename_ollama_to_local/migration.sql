-- EP-AGENT-CAP-002-CLEANUP: Rename Docker Model Runner provider from "ollama" to "local".
-- Must INSERT 'local' before updating FK children (PostgreSQL enforces FK on each statement).
-- No-op if 'local' already exists or 'ollama' does not exist.
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM "ModelProvider" WHERE "providerId" = 'ollama')
     AND NOT EXISTS (SELECT 1 FROM "ModelProvider" WHERE "providerId" = 'local') THEN
    -- Insert 'local' first so FK children can reference it
    INSERT INTO "ModelProvider" (id, "providerId", name, families, status, "updatedAt", "authHeader", "computeWatts", "costModel", "electricityRateKwh", "enabledFamilies", endpoint, "inputPricePerMToken", "outputPricePerMToken", category, "baseUrl", "authMethod", "supportedAuthMethods", "consoleUrl", "docsUrl", "billingLabel", "costPerformanceNotes", "endpointType", "sensitivityClearance", "capabilityTier", "costBand", "taskTags", "mcpTransport", "maxConcurrency", "catalogVisibility", "catalogEntry", "supportedModalities", "supportsToolUse", "supportsStructuredOutput", "supportsStreaming", "maxContextTokens", "maxOutputTokens")
    SELECT 'local-provider-init', 'local', name, families, status, "updatedAt", "authHeader", "computeWatts", "costModel", "electricityRateKwh", "enabledFamilies", endpoint, "inputPricePerMToken", "outputPricePerMToken", category, "baseUrl", "authMethod", "supportedAuthMethods", "consoleUrl", "docsUrl", "billingLabel", "costPerformanceNotes", "endpointType", "sensitivityClearance", "capabilityTier", "costBand", "taskTags", "mcpTransport", "maxConcurrency", "catalogVisibility", "catalogEntry", "supportedModalities", "supportsToolUse", "supportsStructuredOutput", "supportsStreaming", "maxContextTokens", "maxOutputTokens"
    FROM "ModelProvider" WHERE "providerId" = 'ollama';
    -- Now update FK children to reference 'local'
    UPDATE "ModelProfile" SET "providerId" = 'local' WHERE "providerId" = 'ollama';
    UPDATE "DiscoveredModel" SET "providerId" = 'local' WHERE "providerId" = 'ollama';
    UPDATE "AgentModelConfig" SET "pinnedProviderId" = 'local' WHERE "pinnedProviderId" = 'ollama';
  END IF;
END $$;
