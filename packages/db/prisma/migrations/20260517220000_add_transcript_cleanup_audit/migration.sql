-- Voice Slice 2 — Transcript cleanup audit row.
--
-- Spec: docs/superpowers/specs/2026-05-16-voice-input-and-transcription-design.md §8 Slice 2, §9
-- Plan: docs/superpowers/plans/2026-05-17-voice-input-slice-2-cleanup-and-bias.md
--
-- Slice 2 of the voice input feature adds a cleanup pass that runs a
-- small-tier LLM over the raw STT output to strip filler words and dictation
-- artifacts. This table captures only the rows that matter for quality
-- regression and security audit:
--   - injectionSuspected = true (heuristic detector caught instruction-shape)
--   - Levenshtein ratio > 0.3 (cleanup materially rewrote the user's intent)
-- No-op cleanups are intentionally NOT logged.

CREATE TABLE "TranscriptCleanupAudit" (
  "id"                  TEXT NOT NULL,
  "threadId"            TEXT,
  "agentMessageId"      TEXT,
  "userId"              TEXT,
  "rawText"             TEXT NOT NULL,
  "cleanedText"         TEXT NOT NULL,
  "levenshteinRatio"    DOUBLE PRECISION NOT NULL,
  "injectionSuspected"  BOOLEAN NOT NULL DEFAULT FALSE,
  "injectionIndicators" TEXT[] NOT NULL DEFAULT '{}',
  "providerId"          TEXT,
  "modelId"             TEXT,
  "durationMs"          INTEGER,
  "createdAt"           TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "TranscriptCleanupAudit_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "TranscriptCleanupAudit_createdAt_idx"
  ON "TranscriptCleanupAudit" ("createdAt");

CREATE INDEX "TranscriptCleanupAudit_injectionSuspected_idx"
  ON "TranscriptCleanupAudit" ("injectionSuspected");

CREATE INDEX "TranscriptCleanupAudit_threadId_createdAt_idx"
  ON "TranscriptCleanupAudit" ("threadId", "createdAt");
