-- Activity Quiescence Protocol — schema foundation.
--
-- Spec: docs/superpowers/specs/2026-05-24-activity-quiescence-protocol-design.md §5.1
-- BI:   BI-QUIESCE-001 (Phase 1, blocking prerequisite for all other BI-QUIESCE-*)
-- Parent BI: BI-40F05BAC (research); BI-5B3FA415 (governed upgrade lifecycle)
--
-- Two additive changes:
--   1. TaskRun.quiescedAt — timestamp the coordinator wrote when flipping the
--      row to status='quiescing' during a normal→draining transition. Null
--      on rows that have never been part of a quiescence cycle.
--   2. QuiescenceRun table — per-drain audit substrate. One row per
--      orchestrated drain attempt; carries the ActiveSessionBlockers snapshot,
--      the state-machine transition history, defer/abort/force-cancel audit,
--      and stuck-coordinator detection signal (lastHeartbeatAt). See spec
--      §5.1 for full field rationale.
--
-- Migration is additive-only (no DROP, no ALTER … NOT NULL on existing rows).
-- The new TASK_STATES values ('quiescing', 'paused-for-upgrade',
-- 'paused-for-upgrade-forced') are application-layer constants in
-- apps/web/lib/tak/task-states.ts; we don't add a Postgres CHECK constraint
-- because status validation already lives at the application layer (matches
-- existing pattern for 'stalled' added in BI-4ab6be39).

-- ─── 1. TaskRun.quiescedAt ─────────────────────────────────────────────────

ALTER TABLE "TaskRun" ADD COLUMN "quiescedAt" TIMESTAMP(3);

-- ─── 2. QuiescenceRun table ────────────────────────────────────────────────

CREATE TABLE "QuiescenceRun" (
    "id" TEXT NOT NULL,
    "runId" TEXT NOT NULL,
    "trigger" TEXT NOT NULL,
    "triggerRefId" TEXT,

    "status" TEXT NOT NULL,
    "startedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "enteredStateAt" JSONB NOT NULL DEFAULT '{}',
    "swapStartedAt" TIMESTAMP(3),
    "swapCompletedAt" TIMESTAMP(3),
    "completedAt" TIMESTAMP(3),
    "lastHeartbeatAt" TIMESTAMP(3),

    "initialSnapshot" JSONB NOT NULL,
    "finalSnapshot" JSONB,

    "targetVersion" TEXT,
    "targetBundleHash" TEXT,

    "budgetMs" INTEGER NOT NULL,
    "actualWaitMs" INTEGER,

    "deferReason" TEXT,
    "deferSurface" TEXT,
    "forcedSurfaces" JSONB NOT NULL DEFAULT '[]',

    "outcome" TEXT,
    "completionSource" TEXT,
    "outcomeNotes" TEXT,

    CONSTRAINT "QuiescenceRun_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "QuiescenceRun_runId_key" ON "QuiescenceRun"("runId");

-- Audit query: "show me all quiescence runs the self-upgrade caller has
-- attempted in the last 24h" (operator forensics on a flaky upgrade).
CREATE INDEX "QuiescenceRun_trigger_startedAt_idx"
    ON "QuiescenceRun"("trigger", "startedAt");

-- Stuck-coordinator detection (BI-QUIESCE-007): the watchdog scans for rows
-- WHERE status NOT IN ('completed','deferred','aborted','failed')
--   AND lastHeartbeatAt < (now - 2 min)
-- and forces level back to normal + emits platform.quiescence-cleared. This
-- index makes that scan cheap even as the audit table grows.
CREATE INDEX "QuiescenceRun_status_lastHeartbeatAt_idx"
    ON "QuiescenceRun"("status", "lastHeartbeatAt");
