-- McpToolSession — per-token deferred-tool-loading state (BI-D8101329,
-- MCP tool-tier Phase 2 / context-engineering R3). Purely additive: a new
-- table, no changes to existing rows, so it applies cleanly against any
-- existing data state. Discovery-only state (which tool names a model pulled
-- into scope via load_tools); it carries no authorization meaning — tools/call
-- still gates on grants.
CREATE TABLE "McpToolSession" (
    "tokenId" TEXT NOT NULL,
    "loadedToolNames" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "McpToolSession_pkey" PRIMARY KEY ("tokenId")
);

CREATE INDEX "McpToolSession_expiresAt_idx" ON "McpToolSession"("expiresAt");
