-- BI-2624B7EA: admit the employment lifecycle definitions to WorkCapsule.source.
--
-- THE DEFECT THIS FIXES: the actuator could not open a single Workroom. The
-- three employment definition keys were added to the TypeScript closed set
-- (WORK_CAPSULE_SOURCES) but not to the DATABASE check constraint that mirrors
-- it, so every spawn failed with:
--
--   23514  new row for relation "WorkCapsule" violates check constraint
--          "WorkCapsule_source_closed_set"
--
-- TypeScript said the source was valid; Postgres disagreed. Worse than a failed
-- spawn: the actuator runs inside the transaction that writes the
-- EmploymentEvent, so the constraint violation rolled the WHOLE EVENT back.
-- Recording a hire would have thrown, and the hire would not have been recorded
-- at all — a regression on behaviour that worked before the actuator existed.
--
-- No unit test could see this. The closed set has FIVE homes and only four are
-- TypeScript: the WORK_CAPSULE_SOURCES array, the BUSINESS_WORK_CAPSULE_SOURCES
-- set, the derived MCP tool enum, the enum-parity test — and this constraint.
-- It took a real Postgres to find the fifth.
--
-- Idempotent and safe against any existing data state: the new set is a strict
-- superset of the old one, so no existing row can violate it. Dropped and
-- recreated because Postgres cannot widen a CHECK in place.
--
-- Recreated NOT VALID to match the original: the constraint was already NOT
-- VALID (legacy rows predate the closed set), and validating it here would scan
-- and could fail on historical values this migration is not chartered to clean.

ALTER TABLE "WorkCapsule" DROP CONSTRAINT IF EXISTS "WorkCapsule_source_closed_set";

ALTER TABLE "WorkCapsule" ADD CONSTRAINT "WorkCapsule_source_closed_set" CHECK (
  source = ANY (ARRAY[
    'backlog'::text,
    'build-studio'::text,
    'external-adoption'::text,
    'git-promotion'::text,
    'manual'::text,
    'scheduled-steward'::text,
    -- Employment lifecycle (BI-28EFA338 registered them; BI-2624B7EA spawns them).
    'worker-onboarding'::text,
    'worker-change'::text,
    'worker-offboarding'::text
  ])
) NOT VALID;
