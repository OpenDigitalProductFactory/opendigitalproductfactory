-- BI-05715F4C (EP-07B49BD8): a Workroom issues each agent-CLI session its own
-- MCP credential, scoped to the room and run, and revokes it when the session
-- stops. Design: docs/superpowers/specs/2026-10-07-durable-delegation-ledger-design.md
-- §4.7. The credential is an McpApiToken row (kind workroom_session), the same
-- governed object as every other MCP token, so it has one resolution path, one
-- revocation surface and one audit shape.
--
-- Additive: two nullable columns and a plain index. Existing rows read NULL and
-- keep behaving exactly as before. Safe against any data state and re-runnable.
ALTER TABLE "McpApiToken" ADD COLUMN IF NOT EXISTS "workroomRef" TEXT;
ALTER TABLE "McpApiToken" ADD COLUMN IF NOT EXISTS "runRef" TEXT;
CREATE INDEX IF NOT EXISTS "McpApiToken_workroomRef_revokedAt_idx" ON "McpApiToken"("workroomRef", "revokedAt");
