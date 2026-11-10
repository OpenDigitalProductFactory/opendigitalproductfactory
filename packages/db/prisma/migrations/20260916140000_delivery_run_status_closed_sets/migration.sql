-- The delivery plane's own run-status columns become closed sets (BI-9F6AFFA0).
--
-- AGENTS.md §8: closed-set string fields are never free-form strings. Both
-- columns below carried their vocabulary in a DOC COMMENT above a TEXT column,
-- which is not a constraint:
--
--   TaskRun.status                -- "A2A-aligned task states: submitted | working | ..."
--   ScheduledAgentTask.lastStatus -- "ok | error"
--
-- and the second comment was already FALSE: #5335 writes "proposed", and this
-- install holds one such row. A comment cannot be wrong in a way anything
-- notices; a constraint can.
--
-- WHY A CHECK AND NOT A NATIVE ENUM. 20260912070000 records the distinction
-- this repo already drew: a brand-new closed set "can be born correct instead
-- of being retrofitted with a NOT VALID CHECK the way the long-lived TEXT
-- columns were". These are long-lived. TaskRun.status alone holds 4,176 rows on
-- the reference install and its hyphenated values ("input-required") cannot be
-- Prisma enum identifiers, so a native enum requires @map, which renames every
-- literal: 431 sites across 155 files. That is a separate, correctly-sized
-- piece of work, re-scoped on BI-9F6AFFA0, and it is not what closes the hole.
--
-- NOT VALID is deliberate and matches 20260816111000 / 20260909213000: new
-- writes and updates are enforced, existing rows are not re-scanned, so this
-- applies cleanly against ANY data state and can never block an upgrade
-- (AGENTS.md §2). The lesson from 20260909213000 is that an INCOMPLETE set is
-- the real hazard — a missing value fails at the first UPDATE, not the INSERT —
-- so both sets below are taken from the TypeScript unions verbatim, and a
-- parity test now fails the build if they ever drift.

-- 1. Correct the rows the A1 defect wrote (BI-FF63D266).
--
-- semantic-review-background.ts persisted an inconclusive review as "failed",
-- which AGENTS.md §4 forbids: a check that could not determine anything is
-- never a FAIL against the diff. The receipt's own resultClass recorded the
-- truth all along, so the correction reads from it rather than guessing.
-- Scoped to semantic-review runs that actually recorded "inconclusive"; the
-- other failed reviews carry no resultClass and are genuine failures, so they
-- are deliberately untouched. Idempotent: a re-run reports UPDATE 0.
UPDATE "TaskRun"
SET "status" = 'input-required'
WHERE "status" = 'failed'
  AND "a2aMetadata" ->> 'gateKind' = 'semantic-review'
  AND "progressPayload" ->> 'resultClass' = 'inconclusive';

-- 2. Retire the legacy live-status alias if any row still carries it.
--
-- task-states.ts documents "active" as a legacy alias for "working". Every use
-- of TASK_LIVE_STATES in the tree is a READ filter, no writer was found, and
-- this install holds zero such rows — so this is a no-op here and a safety net
-- on an install that has one. Idempotent.
UPDATE "TaskRun" SET "status" = 'working' WHERE "status" = 'active';

-- 3. TaskRun.status closed set — TASK_STATES in apps/web/lib/tak/task-states.ts.
ALTER TABLE "TaskRun" DROP CONSTRAINT IF EXISTS "TaskRun_status_closed_set";
ALTER TABLE "TaskRun"
  ADD CONSTRAINT "TaskRun_status_closed_set" CHECK (
    status = ANY (ARRAY[
      'submitted'::text,
      'working'::text,
      'input-required'::text,
      'auth-required'::text,
      'completed'::text,
      'failed'::text,
      'canceled'::text,
      'rejected'::text,
      'archived'::text,
      'stalled'::text,
      'quiescing'::text,
      'paused-for-upgrade'::text,
      'paused-for-upgrade-forced'::text
    ])
  ) NOT VALID;

-- 4. ScheduledAgentTask.lastStatus closed set — the three values actually
-- written, including the "proposed" that #5335 added and the comment denied.
-- NULL stays legal: a task that has not run has no last status, which is a
-- different statement from a task that ran and produced nothing.
ALTER TABLE "ScheduledAgentTask" DROP CONSTRAINT IF EXISTS "ScheduledAgentTask_lastStatus_closed_set";
ALTER TABLE "ScheduledAgentTask"
  ADD CONSTRAINT "ScheduledAgentTask_lastStatus_closed_set" CHECK (
    "lastStatus" IS NULL OR "lastStatus" = ANY (ARRAY[
      'ok'::text,
      'error'::text,
      'proposed'::text
    ])
  ) NOT VALID;
