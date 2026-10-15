-- Default-deny policy projection for dynamically discovered external MCP tools
-- (BI-8B7B2FE9). Spec: docs/superpowers/specs/2026-08-30-security-authentication-hardening-successors-design.md §11.
-- Plan: docs/superpowers/plans/2026-08-30-external-mcp-tool-default-deny.md Phase 2.
--
-- Additive: three enums, new nullable/defaulted columns on "McpServerTool", one
-- FK to "Principal". Fail closed: every existing row lands `quarantined` through
-- the column default. isEnabled, server health, descriptions and remote
-- annotations never imply approval.
--
-- The one deterministic exception is the release's bundled policy: the six
-- browser-use sidecar tools that TOOL_TO_GRANTS maps under their namespaced
-- names (`mcp-browser-use__<tool>`). Those rows become `approved` by exact
-- (server slug, tool name) match. Their grant and effect stay code-owned, so no
-- policy columns are written for them. Disabled rows keep isEnabled = false.
--
-- IF NOT EXISTS / duplicate_object guards make a re-run harmless; the backfill
-- only touches rows still at the quarantined default with no approval, so it
-- applies cleanly to an empty, a populated or a partially migrated registry.

-- @migration-safety: data-safe: every constrained column is new. The NOT NULL
-- columns carry a DEFAULT that fills existing rows in the same statement, and
-- the approvedByPrincipalId FK constrains a column added NULL here, so no
-- existing row can violate it.

DO $$ BEGIN
    CREATE TYPE "McpToolPolicyStatus" AS ENUM ('quarantined', 'approved', 'denied');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
    CREATE TYPE "McpToolEffect" AS ENUM ('read-only', 'side-effecting');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
    CREATE TYPE "McpToolExecutionMode" AS ENUM ('advise', 'act');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

ALTER TABLE "McpServerTool"
    ADD COLUMN IF NOT EXISTS "policyStatus" "McpToolPolicyStatus" NOT NULL DEFAULT 'quarantined',
    ADD COLUMN IF NOT EXISTS "policyEffect" "McpToolEffect",
    ADD COLUMN IF NOT EXISTS "policyExecutionModes" "McpToolExecutionMode"[] NOT NULL DEFAULT ARRAY[]::"McpToolExecutionMode"[],
    ADD COLUMN IF NOT EXISTS "policyGrantKey" TEXT,
    ADD COLUMN IF NOT EXISTS "policyVersion" INTEGER,
    ADD COLUMN IF NOT EXISTS "approvedToolIdentity" TEXT,
    ADD COLUMN IF NOT EXISTS "approvedContentDigest" TEXT,
    ADD COLUMN IF NOT EXISTS "approvedDescription" TEXT,
    ADD COLUMN IF NOT EXISTS "approvedInputSchema" JSONB,
    ADD COLUMN IF NOT EXISTS "approvedByPrincipalId" TEXT,
    ADD COLUMN IF NOT EXISTS "approvedAt" TIMESTAMP(3),
    ADD COLUMN IF NOT EXISTS "policyChangedAt" TIMESTAMP(3),
    ADD COLUMN IF NOT EXISTS "discoveredContentDigest" TEXT,
    ADD COLUMN IF NOT EXISTS "discoveryHints" JSONB;

DO $$ BEGIN
    ALTER TABLE "McpServerTool"
        ADD CONSTRAINT "McpServerTool_approvedByPrincipalId_fkey"
        FOREIGN KEY ("approvedByPrincipalId") REFERENCES "Principal"("id")
        ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

CREATE INDEX IF NOT EXISTS "McpServerTool_policyStatus_idx" ON "McpServerTool"("policyStatus");
CREATE INDEX IF NOT EXISTS "McpServerTool_approvedByPrincipalId_idx" ON "McpServerTool"("approvedByPrincipalId");

-- Bundled coverage: exact canonical mapping only.
UPDATE "McpServerTool" AS t
SET "policyStatus" = 'approved',
    "policyChangedAt" = CURRENT_TIMESTAMP
FROM "McpServer" AS s
WHERE t."serverId" = s."id"
  AND s."serverId" = 'mcp-browser-use'
  AND t."toolName" IN (
    'browse_open',
    'browse_extract',
    'browse_screenshot',
    'browse_close',
    'browse_run_tests',
    'browse_act'
  )
  AND t."policyStatus" = 'quarantined'
  AND t."approvedAt" IS NULL;
