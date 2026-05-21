-- EP-COST Phase 1: cache telemetry field + AgentBudgetEvent table
-- Spec: docs/superpowers/specs/2026-05-19-ai-cost-governance.md §3 Phase 1 & Phase 2 prereq
--
-- 1. Add cacheCreationInputTokens to AdapterRunTelemetry
--    (tokens written into the Anthropic prompt cache — billed at write rate)
ALTER TABLE "AdapterRunTelemetry" ADD COLUMN "cacheCreationInputTokens" INTEGER;

-- 2. Create AgentBudgetEvent — one row per budget event for Phase 2 gate
CREATE TABLE "AgentBudgetEvent" (
    "id"          TEXT NOT NULL,
    "agentId"     TEXT NOT NULL,
    "buildRunId"  TEXT,
    "eventKind"   TEXT NOT NULL,
    "amountUsd"   DECIMAL(10,6) NOT NULL,
    "tokensTotal" INTEGER,
    "modelId"     TEXT,
    "providerId"  TEXT,
    "createdAt"   TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AgentBudgetEvent_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "AgentBudgetEvent_agentId_createdAt_idx" ON "AgentBudgetEvent"("agentId", "createdAt");
CREATE INDEX "AgentBudgetEvent_buildRunId_idx" ON "AgentBudgetEvent"("buildRunId");
