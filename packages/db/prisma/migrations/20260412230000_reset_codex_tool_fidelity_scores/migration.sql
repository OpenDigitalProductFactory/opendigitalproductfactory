-- Reset toolFidelity scores for codex models that were locked at 10
-- after inconclusive evals promoted profileSource to "evaluated".
--
-- Root cause: eval-runner set profileSource="evaluated" even when all
-- dimensions were inconclusive (no real scores written). This prevented
-- seedKnownModels from correcting stale catalog values.
--
-- The fix in eval-runner.ts now only promotes profileSource when real
-- scores are written. This migration resets the affected records so that
-- the next seed run can apply the correct catalog scores (80 for
-- gpt-5.3-codex and gpt-5.4 on the codex provider).
--
-- Only resets models whose toolFidelity is 10 AND profileSource is
-- "evaluated" AND they are NOT intentionally low-fidelity models
-- (codex-mini-latest and chatgpt/gpt-5.4 are intentionally 10).

UPDATE "ModelProfile"
SET
  "profileSource" = 'seed',
  "profileConfidence" = 'medium'
WHERE
  "providerId" = 'codex'
  AND "modelId" NOT IN ('codex-mini-latest')
  AND "toolFidelity" = 10
  AND "profileSource" = 'evaluated';
