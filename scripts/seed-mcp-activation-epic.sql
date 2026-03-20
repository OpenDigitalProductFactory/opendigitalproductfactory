-- EP-MCP-ACT-001: MCP Catalog Activation & External Services Surface
-- Seeds the backlog epic for tracking implementation progress.

-- Insert the Epic
INSERT INTO "Epic" ("id", "epicId", "title", "description", "status", "createdAt", "updatedAt")
VALUES (
  gen_random_uuid()::text,
  'EP-MCP-ACT-001',
  'MCP Catalog Activation & External Services Surface',
  'Enable lifecycle for external MCP services: discover from catalog, activate with connection config, health check, tool discovery, admin surface. Spec: docs/superpowers/specs/2026-03-20-mcp-activation-and-services-surface-design.md',
  'in-progress',
  NOW(),
  NOW()
)
ON CONFLICT ("epicId") DO UPDATE SET
  "title" = EXCLUDED."title",
  "description" = EXCLUDED."description",
  "status" = EXCLUDED."status",
  "updatedAt" = NOW();

-- Insert the BacklogItem (epic reference)
INSERT INTO "BacklogItem" ("id", "itemId", "title", "body", "status", "priority", "type", "epicId", "createdAt", "updatedAt")
SELECT
  gen_random_uuid()::text,
  'EP-MCP-ACT-001',
  'MCP Catalog Activation & External Services Surface',
  'Enable lifecycle for external MCP services: discover from catalog, activate with connection config, health check, tool discovery, admin surface. Spec: docs/superpowers/specs/2026-03-20-mcp-activation-and-services-surface-design.md',
  'in-progress',
  1,
  'epic',
  e.id,
  NOW(),
  NOW()
FROM "Epic" e
WHERE e."epicId" = 'EP-MCP-ACT-001'
ON CONFLICT ("itemId") DO UPDATE SET
  "title" = EXCLUDED."title",
  "body" = EXCLUDED."body",
  "status" = EXCLUDED."status",
  "updatedAt" = NOW();
