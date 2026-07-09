-- BI-FDECBE0A (EP-8C706944 P1): durable rolling compaction checkpoint on AgentThread.
-- Additive, nullable + defaulted — safe against any existing row (no backfill needed).
-- @migration-safety: data-safe: all three columns are nullable or have a DEFAULT, so no existing AgentThread row can violate them.
ALTER TABLE "AgentThread" ADD COLUMN "compactedSummary" TEXT;
ALTER TABLE "AgentThread" ADD COLUMN "compactionWatermarkAt" TIMESTAMP(3);
ALTER TABLE "AgentThread" ADD COLUMN "compactedTurnCount" INTEGER NOT NULL DEFAULT 0;
