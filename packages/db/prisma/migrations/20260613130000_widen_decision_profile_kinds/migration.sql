-- Widen DecisionPerspectiveProfile.kind CHECK to match the canonical
-- DECISION_PROFILE_KINDS registry (apps/web/lib/decision-perspective/types.ts).
-- The original constraint (2026-05-17) only allowed platform/organization/
-- customer/team, so the later-added persona-* kinds and the WSID "profession"
-- kind silently failed to seed (caught as SKIP), leaving profession profiles
-- absent. This realigns the DB constraint with the single source of truth so
-- WSID profession profiles (and persona profiles) seed cleanly.
ALTER TABLE "DecisionPerspectiveProfile" DROP CONSTRAINT IF EXISTS "DecisionPerspectiveProfile_kind_check";
ALTER TABLE "DecisionPerspectiveProfile" ADD CONSTRAINT "DecisionPerspectiveProfile_kind_check"
  CHECK ("kind" IN (
    'platform',
    'organization',
    'customer',
    'team',
    'persona-real',
    'persona-fictional',
    'persona-synthetic',
    'profession'
  ));
