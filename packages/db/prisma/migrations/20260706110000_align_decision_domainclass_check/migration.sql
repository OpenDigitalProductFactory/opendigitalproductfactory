-- Align the domainClass CHECK constraints with the DECISION_DOMAIN_CLASSES
-- registry (apps/web/lib/decision-perspective/types.ts). The 20260517233000
-- constraints froze the set at the original three values; the registry has
-- since added 'professional-practice' (WSID) and 'kernel-consult' (the
-- principle_decide audit ledger, #2647). The drift made every kernel-consult
-- ledger write fail its CHECK on live installs — observably (fail-open
-- ledger.recorded=false), but the audit trail stayed empty.
--
-- @migration-safety: data-safe: strictly widens the allowed value set of two
-- CHECK constraints; every row valid under the old three-value set is valid
-- under the five-value set, so no existing row can violate it.

ALTER TABLE "DecisionInteraction" DROP CONSTRAINT IF EXISTS "DecisionInteraction_domainClass_check";
ALTER TABLE "DecisionInteraction" ADD CONSTRAINT "DecisionInteraction_domainClass_check"
  CHECK ("domainClass" IN ('plan-readiness', 'architecture-tradeoff', 'risk-assessment', 'professional-practice', 'kernel-consult'));

ALTER TABLE "PerspectiveMaterial" DROP CONSTRAINT IF EXISTS "PerspectiveMaterial_domainClass_check";
ALTER TABLE "PerspectiveMaterial" ADD CONSTRAINT "PerspectiveMaterial_domainClass_check"
  CHECK ("domainClass" IN ('plan-readiness', 'architecture-tradeoff', 'risk-assessment', 'professional-practice', 'kernel-consult'));
