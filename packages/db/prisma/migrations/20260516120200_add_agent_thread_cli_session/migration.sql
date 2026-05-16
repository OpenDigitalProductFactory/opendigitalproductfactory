-- AgentThread cliSession* columns — coworker execution adapter substrate (Phase A3).
--
-- Adds five nullable columns and one index to the existing AgentThread table
-- so the CliSessionService (Phase C) can pin a thread to a single CLI session
-- for plan/todo continuity. A sweeper expires stale sessions via the
-- cliSessionLastUsedAt index.
--
-- Plan: docs/superpowers/plans/2026-04-29-coworker-execution-adapter-substrate-plan.md (Task A3)
-- Spec: docs/superpowers/specs/2026-04-29-coworker-execution-adapter-substrate-design.md §4.2
--
-- All columns are nullable so existing AgentThread rows continue to work
-- unchanged with all five fields null. No destructive changes.

-- AlterTable
ALTER TABLE "AgentThread" ADD COLUMN "cliSessionId" TEXT;
ALTER TABLE "AgentThread" ADD COLUMN "cliSessionAdapterKind" TEXT;
ALTER TABLE "AgentThread" ADD COLUMN "cliSessionContainerId" TEXT;
ALTER TABLE "AgentThread" ADD COLUMN "cliSessionLastUsedAt" TIMESTAMP(3);
ALTER TABLE "AgentThread" ADD COLUMN "cliSessionWorkdir" TEXT;

-- CreateIndex
CREATE INDEX "AgentThread_cliSessionLastUsedAt_idx" ON "AgentThread"("cliSessionLastUsedAt");
