-- WorkCapsule.source closed set: register "platform-maintenance" (BI-A5EEB5D1).
--
-- apps/web/lib/wiki/embedding-coverage-workroom.ts upserts the corpus-health
-- room with source = 'platform-maintenance'. That value was never added to
-- "WorkCapsule_source_closed_set", and the constraint is NOT VALID, so the row
-- existed but EVERY UPDATE to it re-validated the check and failed with 23514.
-- The workroom anchor converger hit it once a minute, 1,147 times, and no
-- status transition on that room could ever have succeeded either.
--
-- Same lesson as 20260902040000: TypeScript and Postgres each hold a copy of
-- this closed set. This migration brings Postgres level with
-- WORK_CAPSULE_SOURCES; the parity test in
-- apps/web/lib/work-capsules/work-capsule-source-closed-set.test.ts asserts the
-- two never drift again.
--
-- Recreated NOT VALID to match the original (20260816111000): new writes and
-- updates are enforced, existing rows are not re-scanned. Forward-only; applies
-- against any data state because it only widens the allowed set.

ALTER TABLE "WorkCapsule" DROP CONSTRAINT IF EXISTS "WorkCapsule_source_closed_set";

ALTER TABLE "WorkCapsule" ADD CONSTRAINT "WorkCapsule_source_closed_set" CHECK (
  source = ANY (ARRAY[
    'backlog'::text,
    'build-studio'::text,
    'external-adoption'::text,
    'git-promotion'::text,
    'manual'::text,
    'scheduled-steward'::text,
    'worker-onboarding'::text,
    'worker-change'::text,
    'worker-offboarding'::text,
    'platform-maintenance'::text
  ])
) NOT VALID;
