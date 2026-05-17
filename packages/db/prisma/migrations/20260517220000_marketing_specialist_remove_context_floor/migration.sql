-- Migration: remove the static 16K context floor for marketing-specialist
--
-- The routing pipeline enforces two context minimums:
--   1. Static floor from AgentModelConfig.minimumContextTokens (this migration)
--   2. Dynamic floor = estimatedInputTokens × 1.5  (always active)
--
-- The static floor was blocking local/small-context models even for short,
-- focused marketing tasks. Removing it allows the dynamic floor to govern:
-- a short subtask (~2K input) needs only ~3K context — any model can serve it.
-- A large single-turn request (~15K input) needs ~22K context — only
-- large-context models qualify, which is the correct behaviour.
--
-- The marketing-specialist prompt is updated in this same PR to guide the
-- agent to work in focused atomic turns, keeping each call well within small
-- context windows.

UPDATE "AgentModelConfig"
SET "minimumContextTokens" = 0
WHERE "agentId" = 'marketing-specialist'
  AND "minimumContextTokens" = 16000;
