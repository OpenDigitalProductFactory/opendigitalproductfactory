-- S5 uses the existing McpApiToken carrier. Null does not admit a scoped token.
ALTER TABLE "McpApiToken" ADD COLUMN IF NOT EXISTS "workroomAuthorization" JSONB;
