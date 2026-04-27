-- Phase 1 of local LLM grading: add stability score + operational metric fields.
-- See docs/superpowers/specs/2026-04-26-local-llm-grading-incremental-design.md
-- and docs/superpowers/plans/2026-04-26-local-llm-grading-phase-1-plan.md (Task 1).
--
-- All columns are additive nullable — existing rows keep their data, no backfill.

-- AlterTable
ALTER TABLE "ModelProfile" ADD COLUMN     "stabilityScore" INTEGER,
ADD COLUMN     "lastStabilityCheckAt" TIMESTAMP(3);

-- AlterTable
ALTER TABLE "EndpointTaskPerformance" ADD COLUMN     "tokensPerSecondAvg" DOUBLE PRECISION,
ADD COLUMN     "ttftMsAvg" DOUBLE PRECISION,
ADD COLUMN     "peakVramMbAvg" DOUBLE PRECISION;
