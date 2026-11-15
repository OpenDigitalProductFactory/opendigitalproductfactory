-- BI-A08285BC: a below-floor run becomes a countable event, not a sentence.
--
-- `qualityFloorRelaxed` is set in the hard filter and travels on RouteDecision,
-- where deliberation activation now reads it. It was never persisted, so the
-- question that matters operationally — how often did we run below the quality
-- floor, and when — had no answer at all.
--
-- The column holds the same structural signal the decision carries: whether the
-- floor was relaxed, how many candidates ranked, and whether the winner came
-- from fallback rather than ranking. Counts and booleans only; no request
-- content, consistent with the other receipts on this row.
--
-- Why this matters beyond bookkeeping: every self-upgrade drains the portal, and
-- the incident that motivated this work happened inside such a window. If
-- below-floor runs cluster there, the right fix is upgrade-window routing rather
-- than per-turn escalation — and this column is what would show that.
--
-- Nullable with no backfill: a decision recorded before this column cannot have
-- its confidence reconstructed, and NULL must read as "not recorded" rather than
-- as "routing was confident". Inventing a value would put a fabricated answer
-- where an honest gap belongs.
--
-- @migration-safety: data-safe: adds one nullable JSON column; no rows, types or
-- constraints are changed and nothing is backfilled.

ALTER TABLE "RouteDecisionLog"
  ADD COLUMN IF NOT EXISTS "routingConfidence" JSONB;
