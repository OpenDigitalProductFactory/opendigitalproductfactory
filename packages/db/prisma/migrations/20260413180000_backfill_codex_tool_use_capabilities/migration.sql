-- EP-AGENT-CAP-002 fix: Backfill supportsToolUse and capabilities for Codex models.
--
-- Root cause: The 20260412230000 migration reset profileSource to 'seed' but did
-- NOT reset supportsToolUse or capabilities. The seed update path (profileSource='seed')
-- only wrote score fields, leaving stale capability flags from the inconclusive eval.
-- The seed update path is now fixed, but existing DB rows still have wrong values.
--
-- This migration sets the correct capability flags for the two active Codex models.
-- codex-mini-latest is intentionally excluded (toolUse=false, disabled model).

UPDATE "ModelProfile"
SET
  "supportsToolUse" = true,
  "capabilities" = '{"toolUse": true, "streaming": true, "structuredOutput": true}'::jsonb
WHERE
  "providerId" = 'codex'
  AND "modelId" IN ('gpt-5.3-codex', 'gpt-5.4')
  AND ("supportsToolUse" IS NULL OR "supportsToolUse" = false);
