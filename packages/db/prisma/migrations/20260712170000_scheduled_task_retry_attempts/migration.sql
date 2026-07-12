-- BI-754C9E82: retry-attempt counter for proactivity-plan-driven retries.
-- @migration-safety: data-safe: additive column with a DEFAULT — every existing
-- row satisfies NOT NULL via the default; no constraint can reject existing data.
ALTER TABLE "ScheduledAgentTask" ADD COLUMN "attempts" INTEGER NOT NULL DEFAULT 0;
