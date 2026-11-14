-- BI-B4081AA1: record how a model was called, not only which one was chosen.
--
-- RouteDecisionLog already stored candidate traces, the suitability receipt and
-- the data-screen receipt. It did not store the resolved call parameters, and
-- nothing else did either: the execution plan carried them in memory and
-- formatDecisionForUser — the one function that could explain them — had no
-- callers. So an operator could see why Qwen3 was selected and never that it ran
-- at temperature 1.0.
--
-- The column holds a compact receipt: resolved sampling values, the provenance of
-- each one (vendor / contract / recipe / operator), which vendor profile applied,
-- parameters withheld because the model rejects them, the output ceiling, how
-- effort was expressed, and whether the provider could carry the effort at all.
-- Numbers and provenance only — no prompts, no tool payloads, no request content.
--
-- Nullable with no backfill, deliberately: rows written before this column cannot
-- have their parameters reconstructed, and NULL must read as "not recorded"
-- rather than as "called with no parameters". Inventing a value for historical
-- rows would put a fabricated audit answer where an honest gap belongs.
--
-- @migration-safety: data-safe: adds one nullable JSON column; no rows, types or
-- constraints are changed and nothing is backfilled.

ALTER TABLE "RouteDecisionLog"
  ADD COLUMN IF NOT EXISTS "callParameters" JSONB;
