-- Migration: add-mcp-endpoint-manifest
-- Tasks 1.2, 1.3, 1.4: Unified MCP Coworker Architecture schema extensions

-- Task 1.2: Extend ModelProvider with MCP endpoint manifest fields
ALTER TABLE "ModelProvider" ADD COLUMN "endpointType" TEXT NOT NULL DEFAULT 'llm';
ALTER TABLE "ModelProvider" ADD COLUMN "sensitivityClearance" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[];
ALTER TABLE "ModelProvider" ADD COLUMN "capabilityTier" TEXT NOT NULL DEFAULT 'basic';
ALTER TABLE "ModelProvider" ADD COLUMN "costBand" TEXT NOT NULL DEFAULT 'free';
ALTER TABLE "ModelProvider" ADD COLUMN "taskTags" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[];
ALTER TABLE "ModelProvider" ADD COLUMN "mcpTransport" TEXT;
ALTER TABLE "ModelProvider" ADD COLUMN "maxConcurrency" INTEGER;

-- Task 1.3: Extend AuthorizationDecisionLog with unified coworker audit fields
ALTER TABLE "AuthorizationDecisionLog" ADD COLUMN "endpointUsed" TEXT;
ALTER TABLE "AuthorizationDecisionLog" ADD COLUMN "mode" TEXT;
ALTER TABLE "AuthorizationDecisionLog" ADD COLUMN "routeContext" TEXT;
ALTER TABLE "AuthorizationDecisionLog" ADD COLUMN "sensitivityLevel" TEXT;
ALTER TABLE "AuthorizationDecisionLog" ADD COLUMN "sensitivityOverride" BOOLEAN;

-- Task 1.4: Add archived flag to Agent
ALTER TABLE "Agent" ADD COLUMN "archived" BOOLEAN NOT NULL DEFAULT false;
