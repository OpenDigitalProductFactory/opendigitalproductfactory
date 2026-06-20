-- BI-655507BA: crash-durable agentic-loop ExecutionPlan.
-- Additive, nullable column (no backfill, no default) — safe on a live table.
-- Holds the loop's plan (goal + steps + status) so it survives a process
-- restart, not just context compaction.
ALTER TABLE "AgentThread" ADD COLUMN "executionPlan" JSONB;
