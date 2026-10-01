-- BI-4C6934CF — let the data-growth steward file the findings it detects.
--
-- @migration-safety: data-safe
--
-- `captureCorrectiveFailureBI` has accepted `source: "data-growth"` in its
-- TypeScript union since EP-A33A5C61 slice 5, but BacklogItem_source_closed_set
-- never learned the value. Every nightly attempt failed with
--   23514  new row for relation "BacklogItem" violates check constraint
-- and the capture path swallows its own error by design (best-effort, never
-- throw), so the steward detected persistent findings for eleven consecutive
-- nights and filed nothing. Nothing surfaced but four identical lines in the
-- portal log.
--
-- Widening the constraint is the whole fix: the column stays TEXT, no row
-- changes, and the value is already the one the writer sends. NOT VALID matches
-- the sibling constraints added by 20260816111000_closed_set_check_expand —
-- existing rows are not re-checked, which is correct because no existing row
-- can carry a value this constraint would now reject.
ALTER TABLE "BacklogItem" DROP CONSTRAINT IF EXISTS "BacklogItem_source_closed_set";
ALTER TABLE "BacklogItem" ADD CONSTRAINT "BacklogItem_source_closed_set"
  CHECK ("source" IN (
    'user-request',
    'automated-detection',
    'build-failure',
    'hive-scout',
    'self-upgrade-failure',
    'data-growth'
  )) NOT VALID;
