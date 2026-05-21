-- EP-COST-001 Schema Completion
-- Spec: docs/superpowers/specs/2026-05-19-ai-cost-governance.md
--
-- Adds:
--   1. ToolExecution.inputTokens / outputTokens / costUsd  (Phase 1)
--   2. BuildPhaseRun table  (Phase 3)

-- 1. ToolExecution token metering columns (Phase 1)
ALTER TABLE "ToolExecution"
  ADD COLUMN IF NOT EXISTS "inputTokens"  INTEGER,
  ADD COLUMN IF NOT EXISTS "outputTokens" INTEGER,
  ADD COLUMN IF NOT EXISTS "costUsd"      DOUBLE PRECISION;

-- 2. BuildPhaseRun — per-phase cost rollup (Phase 3)
CREATE TABLE IF NOT EXISTS "BuildPhaseRun" (
  "id"             TEXT          NOT NULL,
  "buildId"        TEXT          NOT NULL,
  "phase"          TEXT          NOT NULL,
  "startedAt"      TIMESTAMP(3)  NOT NULL,
  "completedAt"    TIMESTAMP(3),
  "durationMs"     INTEGER,
  "inputTokens"    INTEGER       NOT NULL DEFAULT 0,
  "outputTokens"   INTEGER       NOT NULL DEFAULT 0,
  "costUsd"        DECIMAL(10,6),
  "providerId"     TEXT,
  "inferenceCount" INTEGER       NOT NULL DEFAULT 0,

  CONSTRAINT "BuildPhaseRun_pkey" PRIMARY KEY ("id")
);

ALTER TABLE "BuildPhaseRun"
  ADD CONSTRAINT "BuildPhaseRun_buildId_fkey"
  FOREIGN KEY ("buildId") REFERENCES "FeatureBuild"("buildId") ON DELETE CASCADE ON UPDATE CASCADE;

CREATE UNIQUE INDEX IF NOT EXISTS "BuildPhaseRun_buildId_phase_key"
  ON "BuildPhaseRun"("buildId", "phase");

CREATE INDEX IF NOT EXISTS "BuildPhaseRun_buildId_phase_idx"
  ON "BuildPhaseRun"("buildId", "phase");

CREATE INDEX IF NOT EXISTS "BuildPhaseRun_buildId_startedAt_idx"
  ON "BuildPhaseRun"("buildId", "startedAt");
