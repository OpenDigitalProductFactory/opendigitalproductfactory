-- Add BacklogItem.workType (closed enum, source-of-truth in
-- apps/web/lib/explore/backlog.ts:BACKLOG_WORK_TYPE_VALUES) and split today's
-- overloaded BacklogItem.source into pure intake-origin values
-- (BACKLOG_SOURCE_VALUES = user-request | automated-detection).
--
-- Spec: docs/superpowers/specs/2026-05-30-unified-backlog-worktype-design.md
-- BI:   BI-FD37173A
--
-- Behavior change for downstream readers:
--   - apps/web/lib/governed-backlog-tee-up.ts now derives FeatureBuild.kind
--     from workType ("bug" -> "fix", else "feature"). The backfill below
--     produces byte-identical kind for every existing row because every
--     legacy source='bug' BI becomes workType='bug'.
--   - apps/web/lib/queue/functions/issue-report-triage.ts dedup query
--     changes from source IN ('bug','process_observer') to workType='bug';
--     same row set because both backfill to workType='bug'.

-- 1. Schema
ALTER TABLE "BacklogItem" ADD COLUMN "workType" TEXT;

-- 2. Backfill workType from the legacy mixed-axis source values.
--    The category-shaped legacy values move into workType:
UPDATE "BacklogItem" SET "workType" = 'bug'      WHERE "source" = 'bug';
UPDATE "BacklogItem" SET "workType" = 'feature'  WHERE "source" = 'feature-gap';
UPDATE "BacklogItem" SET "workType" = 'tool'     WHERE "source" = 'tool-gap';
UPDATE "BacklogItem" SET "workType" = 'skill'    WHERE "source" = 'skill-gap';
UPDATE "BacklogItem" SET "workType" = 'doc'      WHERE "source" = 'doc-gap';

-- Two in-production drift values that were never in the canonical source
-- enum. Both are bug-class auto-detection signals.
UPDATE "BacklogItem" SET "workType" = 'bug'      WHERE "source" = 'process_observer';
UPDATE "BacklogItem" SET "workType" = 'bug'      WHERE "source" = 'issue_report';

-- Rows whose source is a pure origin value (user-request, automated-detection)
-- or NULL stay workType=NULL. The ops backlog UI shows an "Unclassified" badge
-- for these and surfaces them in a triage filter so an operator can classify.

-- 3. Canonicalize source to the refined origin-only enum
--    (BACKLOG_SOURCE_VALUES = user-request | automated-detection).
--
--    The historical column was free-form (no DB constraint), so production
--    accumulated ~150 distinct values besides the documented enum: the legacy
--    category values (feature-gap, bug, tool-gap, skill-gap, doc-gap), the
--    in-production drift values (process_observer, issue_report), and a long
--    tail of freeform tags (pr-XXX PR numbers, worktree names, phase labels,
--    hive-scout, spec, …) that were never intended as enum values.
--
--    Every row whose source is NOT NULL and NOT already a canonical origin
--    value is collapsed to 'automated-detection' — the right honest label
--    for "the system put this in the backlog through some path we no longer
--    track precisely." Hand-filed BIs from human operators are already
--    source='user-request' and are untouched. NULL stays NULL.
--
--    The work-type classification for the legacy CATEGORY values is captured
--    in step 2 above (workType). For the freeform tail (pr-XXX, worktree-*,
--    hive-scout, spec, etc.) workType remains NULL and the UI surfaces an
--    "unclassified" badge so an operator can reclassify when they next touch
--    the item. Phase 1 will tighten this column to a DB-level enum once
--    Phase 0 has accrued evidence.
UPDATE "BacklogItem"
SET "source" = 'automated-detection'
WHERE "source" IS NOT NULL
  AND "source" NOT IN ('user-request', 'automated-detection');
