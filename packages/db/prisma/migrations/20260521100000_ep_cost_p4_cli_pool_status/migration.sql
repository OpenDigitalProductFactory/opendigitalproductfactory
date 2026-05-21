-- EP-COST-001 Phase 4: CLI Pool Status
-- Spec: docs/superpowers/specs/2026-05-19-ai-cost-governance.md §4d
--
-- Tracks the last-known rate-limit state for each CLI adapter pool.
-- One row per adapter type (claude-cli, codex-cli); upserted on 429 events.

CREATE TABLE IF NOT EXISTS "CliPoolStatus" (
  "id"                TEXT NOT NULL,
  "adapterType"       TEXT NOT NULL,
  "providerId"        TEXT NOT NULL,
  "rateLimitedAt"     TIMESTAMP(3) NOT NULL,
  "resetAt"           TIMESTAMP(3),
  "retryAfterSeconds" INTEGER,
  "errorSnippet"      TEXT,
  "updatedAt"         TIMESTAMP(3) NOT NULL,

  CONSTRAINT "CliPoolStatus_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "CliPoolStatus_adapterType_key"
  ON "CliPoolStatus"("adapterType");

CREATE INDEX IF NOT EXISTS "CliPoolStatus_adapterType_resetAt_idx"
  ON "CliPoolStatus"("adapterType", "resetAt");
