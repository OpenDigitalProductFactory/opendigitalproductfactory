-- Add additive classification for service-style ModelProvider rows so
-- Tools IA can distinguish MCP-backed services from built-in platform tools
-- without rewriting the provider schema.
ALTER TABLE "ModelProvider"
ADD COLUMN "serviceKind" TEXT;

UPDATE "ModelProvider"
SET "serviceKind" = CASE
  WHEN "providerId" IN ('brave-search', 'public-fetch', 'public-web-fetch', 'branding-analyzer') THEN 'built_in'
  ELSE 'mcp'
END
WHERE "endpointType" = 'service';
