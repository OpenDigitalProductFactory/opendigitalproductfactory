-- Add encrypted recoverable material for MCP API tokens issued after this
-- migration. Existing hash-only tokens remain valid but cannot be copied.
ALTER TABLE "McpApiToken"
  ADD COLUMN "tokenSuffix" TEXT,
  ADD COLUMN "secretEnc" TEXT;

