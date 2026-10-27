-- BI-835F9A12. Kernel decline consults write DecisionInteraction.outcomeType
-- 'decline' (apps/web/lib/decision/kernel-consult-ledger.ts). The check added
-- by 20260517230000_add_decision_perspective only allows recommend, arbitrate,
-- escalate, and defer, so Postgres rejects the insert (23514
-- DecisionInteraction_outcomeType_check) and the consult cannot persist.
--
-- This only widens the allowed set, so every existing row stays valid.
-- No row is rewritten, deleted, or reclassified.
--
-- @migration-safety: data-safe: strictly widens the allowed value set of
-- DecisionInteraction_outcomeType_check; every row valid under the old
-- four-value set is valid under the five-value set, so no existing row can
-- violate it.

ALTER TABLE "DecisionInteraction" DROP CONSTRAINT IF EXISTS "DecisionInteraction_outcomeType_check";
ALTER TABLE "DecisionInteraction" ADD CONSTRAINT "DecisionInteraction_outcomeType_check"
  CHECK ("outcomeType" IN ('recommend', 'arbitrate', 'escalate', 'defer', 'decline'));
