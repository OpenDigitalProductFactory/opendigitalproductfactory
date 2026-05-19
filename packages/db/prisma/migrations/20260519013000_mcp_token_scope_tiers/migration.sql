-- Rename the coarse MCP token authority field to match the operator-facing
-- read/write/admin scope model. Granular per-tool grants remain in scopes[].
ALTER TABLE "McpApiToken" RENAME COLUMN "capability" TO "scope";

UPDATE "McpApiToken"
SET "scope" = 'read'
WHERE "scope" NOT IN ('read', 'write', 'admin');

ALTER TABLE "McpApiToken"
  ALTER COLUMN "scope" SET DEFAULT 'read';

ALTER TABLE "McpApiToken"
  ADD CONSTRAINT "McpApiToken_scope_check"
  CHECK ("scope" IN ('read', 'write', 'admin'));
