-- Migration: capability_inventory_phase2
-- Adds authMode and credentialOwnerMode to ModelProvider and McpServer.
-- These fields support the Capability Inventory auth formalization (Phase 2).

-- ModelProvider: auth formalization fields
ALTER TABLE "ModelProvider" ADD COLUMN "authMode" TEXT;
ALTER TABLE "ModelProvider" ADD COLUMN "credentialOwnerMode" TEXT;

-- McpServer: auth formalization fields
ALTER TABLE "McpServer" ADD COLUMN "authMode" TEXT;
ALTER TABLE "McpServer" ADD COLUMN "credentialOwnerMode" TEXT;
