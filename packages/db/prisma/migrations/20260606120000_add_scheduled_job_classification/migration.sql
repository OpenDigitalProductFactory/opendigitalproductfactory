-- BI-5A42E572 / EP-PROACTIVE-OPS: Scheduled Jobs admin surface.
-- Classification + per-job control columns on ScheduledJob.
--   category — "core" (platform-integrity cron, operator read-only) vs
--              "editable" (operationally tunable after install).
--   locked   — blocks operator edits even for an "editable" job until an
--              explicit override clears it; always true for core jobs.
--   enabled  — per-job kill switch complementing the global
--              DPF_SCHEDULED_INNGEST_FUNCTIONS_ENABLED gate.

ALTER TABLE "ScheduledJob" ADD COLUMN "category" TEXT NOT NULL DEFAULT 'editable';
ALTER TABLE "ScheduledJob" ADD COLUMN "locked" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "ScheduledJob" ADD COLUMN "enabled" BOOLEAN NOT NULL DEFAULT true;
