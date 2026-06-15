-- EP-DATA-RETENTION — single-column purge indexes.
--
-- Spec: docs/superpowers/specs/2026-06-14-data-retention-lifecycle-governance-design.md
--
-- The scheduled data-retention sweep deletes rows older than a per-table cutoff
-- using `WHERE <timestamp> < cutoff`. The enrolled high-volume tables below only
-- had COMPOSITE indexes leading with another column (e.g. ToolExecution has
-- (agentId, createdAt) but not (createdAt)), which Postgres cannot use to seek
-- on the timestamp alone — the nightly sweep would seq-scan the busiest tables.
-- These single-column indexes make each purge index-driven. Tiny tables
-- (QuiescenceRun, SelfUpgradeRun) are intentionally not indexed — a scan there
-- is cheap. Tables that already had a single-column timestamp index
-- (Notification, RouteDecisionLog, AuthorizationDecisionLog) are unchanged.

-- CreateIndex
CREATE INDEX "ToolExecution_createdAt_idx" ON "ToolExecution"("createdAt");

-- CreateIndex
CREATE INDEX "AdapterRunTelemetry_startedAt_idx" ON "AdapterRunTelemetry"("startedAt");

-- CreateIndex
CREATE INDEX "TokenUsage_createdAt_idx" ON "TokenUsage"("createdAt");

-- CreateIndex
CREATE INDEX "TaskEvaluation_createdAt_idx" ON "TaskEvaluation"("createdAt");

-- CreateIndex
CREATE INDEX "EndpointTestRun_startedAt_idx" ON "EndpointTestRun"("startedAt");

-- CreateIndex
CREATE INDEX "BuildActivity_createdAt_idx" ON "BuildActivity"("createdAt");

-- CreateIndex
CREATE INDEX "BuildDispatchAttempt_startedAt_idx" ON "BuildDispatchAttempt"("startedAt");

-- CreateIndex
CREATE INDEX "StallEvent_createdAt_idx" ON "StallEvent"("createdAt");

-- CreateIndex
CREATE INDEX "SkillUsageEvent_createdAt_idx" ON "SkillUsageEvent"("createdAt");

-- CreateIndex
CREATE INDEX "WikiIngestEvent_createdAt_idx" ON "WikiIngestEvent"("createdAt");

-- CreateIndex
CREATE INDEX "CoworkerTurnMetric_createdAt_idx" ON "CoworkerTurnMetric"("createdAt");

-- CreateIndex
CREATE INDEX "AgentThread_updatedAt_idx" ON "AgentThread"("updatedAt");
