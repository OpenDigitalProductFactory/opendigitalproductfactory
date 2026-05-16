-- AdapterRunTelemetry — coworker execution adapter substrate (Phase A2).
--
-- One row per adapter execution attempt. Captures latency, tokens, cost,
-- quota pool, status, refusal/error class, tool-call validity, capability
-- usage, and schema-drift detection. Supports the single/shadow/race
-- execution modes via raceCohortId grouping. Feeds nightly outcome scoring.
--
-- Spec: docs/superpowers/specs/2026-04-29-cli-execution-adapter-routing-design.md §4.3
--
-- Includes agentId (PR #607 attribution convention) and skillId (PR #623
-- skill telemetry precedent) so AdapterRunTelemetry rows can join cleanly
-- across the routing and skill telemetry tables.
--
-- Purely additive: creates one new table with four supporting indexes. No
-- existing tables, columns, or enums are touched.

-- CreateTable
CREATE TABLE "AdapterRunTelemetry" (
    "id" TEXT NOT NULL,
    "threadId" TEXT,
    "agentMessageId" TEXT,
    "buildId" TEXT,
    "agentId" TEXT,
    "skillId" TEXT,
    "adapterKind" TEXT NOT NULL,
    "adapterVersion" TEXT NOT NULL,
    "providerId" TEXT NOT NULL,
    "modelId" TEXT NOT NULL,
    "executionMode" TEXT NOT NULL,
    "raceCohortId" TEXT,
    "startedAt" TIMESTAMP(3) NOT NULL,
    "finishedAt" TIMESTAMP(3),
    "durationMs" INTEGER,
    "firstEventLatencyMs" INTEGER,
    "status" TEXT NOT NULL,
    "refusalReason" TEXT,
    "errorClass" TEXT,
    "inputTokens" INTEGER,
    "cachedInputTokens" INTEGER,
    "outputTokens" INTEGER,
    "reasoningTokens" INTEGER,
    "estimatedCostUsd" DECIMAL(10,6),
    "quotaPoolConsumed" TEXT,
    "toolCallsTotal" INTEGER NOT NULL DEFAULT 0,
    "toolCallsInvalid" INTEGER NOT NULL DEFAULT 0,
    "capabilitiesUsed" TEXT[],
    "schemaDriftDetected" BOOLEAN NOT NULL DEFAULT false,
    "userAccepted" BOOLEAN,
    "acceptedAt" TIMESTAMP(3),
    "rawEventDigest" TEXT,

    CONSTRAINT "AdapterRunTelemetry_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "AdapterRunTelemetry_adapterKind_startedAt_idx" ON "AdapterRunTelemetry"("adapterKind", "startedAt");

-- CreateIndex
CREATE INDEX "AdapterRunTelemetry_raceCohortId_idx" ON "AdapterRunTelemetry"("raceCohortId");

-- CreateIndex
CREATE INDEX "AdapterRunTelemetry_threadId_startedAt_idx" ON "AdapterRunTelemetry"("threadId", "startedAt");

-- CreateIndex
CREATE INDEX "AdapterRunTelemetry_agentId_startedAt_idx" ON "AdapterRunTelemetry"("agentId", "startedAt");
