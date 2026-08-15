-- Canonical lifecycle grammar (BI-E55991E9): the LifecycleEvent ledger gains the in-stage
-- STATE axis so it records both stage transitions and in-stage state transitions, enabling
-- two-axis reporting (count-by-stage AND state-within-stage).
--
-- Additive + nullable → backfill-free and safe. Existing rows keep NULL state. The existing
-- fromStatus/toStatus (the closed LifecycleStatus enum) are retained unchanged; fromState/toState
-- hold an OPEN per-grammar StageState.key (apps/web/lib/lifecycle-grammar.ts), not a canonical enum,
-- so no MCP enum mirror applies to them.
ALTER TABLE "LifecycleEvent"
  ADD COLUMN "fromState" TEXT,
  ADD COLUMN "toState" TEXT;
