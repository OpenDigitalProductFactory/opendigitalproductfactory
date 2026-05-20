-- BI-4ab6be39 stall detection — TaskRun.lastHeartbeatAt + watchdog index + StallEvent audit table.
-- See docs/superpowers/specs/2026-05-19-build-studio-stall-detection.md §7.1, §7.3.

ALTER TABLE "TaskRun" ADD COLUMN "lastHeartbeatAt" TIMESTAMP(3);

CREATE INDEX "TaskRun_status_lastHeartbeatAt_idx" ON "TaskRun"("status", "lastHeartbeatAt");

CREATE TABLE "StallEvent" (
    "id" TEXT NOT NULL,
    "taskRunId" TEXT NOT NULL,
    "buildId" TEXT,
    "phase" TEXT,
    "reason" TEXT NOT NULL,
    "detectedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastHeartbeatAt" TIMESTAMP(3),
    "startedAt" TIMESTAMP(3) NOT NULL,
    "thresholdHeartbeatS" INTEGER NOT NULL,
    "thresholdTotalS" INTEGER NOT NULL,
    "outcome" TEXT,
    "outcomeAt" TIMESTAMP(3),
    "outcomeBy" TEXT,
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "StallEvent_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "StallEvent_taskRunId_idx" ON "StallEvent"("taskRunId");
CREATE INDEX "StallEvent_buildId_idx" ON "StallEvent"("buildId");
CREATE INDEX "StallEvent_phase_reason_idx" ON "StallEvent"("phase", "reason");
CREATE INDEX "StallEvent_outcome_idx" ON "StallEvent"("outcome");

ALTER TABLE "StallEvent" ADD CONSTRAINT "StallEvent_taskRunId_fkey" FOREIGN KEY ("taskRunId") REFERENCES "TaskRun"("id") ON DELETE CASCADE ON UPDATE CASCADE;
