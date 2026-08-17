-- @migration-safety: data-safe: plain (non-unique) CREATE INDEX statements only —
-- they cannot fail against any existing data state.
--
-- BI-873F3C48 (Simplify & Strengthen W3, architecture pass 2026-08-16 §3.2-e):
-- leading time-column indexes for the append-only growth tables newly enrolled in
-- the data-retention registry (apps/web/lib/operate/retention/policies.ts). The
-- query path for every index below is the retention sweep itself:
-- apps/web/lib/operate/retention/execute.ts:99 — findMany where
-- { <timestampField>: { lt: cutoff } } — which would seq-scan without a leading
-- index on the policy's timestamp column.

CREATE INDEX "WorkEngagementActivity_recordedAt_idx" ON "WorkEngagementActivity"("recordedAt");
CREATE INDEX "BacklogItemActivity_recordedAt_idx" ON "BacklogItemActivity"("recordedAt");
CREATE INDEX "WorkCapsuleActivity_recordedAt_idx" ON "WorkCapsuleActivity"("recordedAt");
CREATE INDEX "RuntimeCapabilityTransitionEvent_createdAt_idx" ON "RuntimeCapabilityTransitionEvent"("createdAt");
CREATE INDEX "IntegrationCallbackReceipt_createdAt_idx" ON "IntegrationCallbackReceipt"("createdAt");
CREATE INDEX "AgentBudgetEvent_createdAt_idx" ON "AgentBudgetEvent"("createdAt");
CREATE INDEX "IdentityResolutionLog_createdAt_idx" ON "IdentityResolutionLog"("createdAt");
CREATE INDEX "DiscoveryFingerprintObservation_createdAt_idx" ON "DiscoveryFingerprintObservation"("createdAt");
CREATE INDEX "ToolExecutionReceipt_createdAt_idx" ON "ToolExecutionReceipt"("createdAt");
CREATE INDEX "DocumentLifecycleEvent_createdAt_idx" ON "DocumentLifecycleEvent"("createdAt");
CREATE INDEX "LifecycleEvent_createdAt_idx" ON "LifecycleEvent"("createdAt");
CREATE INDEX "HospitalityServiceTurnEvent_occurredAt_idx" ON "HospitalityServiceTurnEvent"("occurredAt");
CREATE INDEX "AppointmentSyncEvent_occurredAt_idx" ON "AppointmentSyncEvent"("occurredAt");
CREATE INDEX "QueueTelemetryEvent_createdAt_idx" ON "QueueTelemetryEvent"("createdAt");
CREATE INDEX "EdgeEvent_createdAt_idx" ON "EdgeEvent"("createdAt");
CREATE INDEX "ChangeEvent_createdAt_idx" ON "ChangeEvent"("createdAt");
CREATE INDEX "StaffingAssignmentEvent_createdAt_idx" ON "StaffingAssignmentEvent"("createdAt");
