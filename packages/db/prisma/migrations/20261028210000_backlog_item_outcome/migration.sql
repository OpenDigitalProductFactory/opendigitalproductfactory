-- BI-8DE5429B (WWMD DI-342D45001EF5): the outcome is an aspect of the backlog
-- item, so it is a field. outcomeSource says who wrote it: "stated" (a person
-- or agent said it) or "derived" (the platform drafted it from the item's own
-- context because nobody did, so it is visible and correctable). Additive and
-- nullable: existing rows hold NULL until the hourly backfill job
-- (ops/backlog-outcome-reconcile) fills open items through the same
-- derivation path intake uses.
ALTER TABLE "BacklogItem"
  ADD COLUMN "outcome" TEXT,
  ADD COLUMN "outcomeSource" TEXT;

-- Closed set (BI-817ED2D4), mirrored by OUTCOME_SOURCES in
-- apps/web/lib/backlog/intake-outcome.ts. An outcome always says who wrote it.
-- @migration-safety: data-safe: both columns are added by this migration, so every existing row holds NULL in both, which the check allows.
ALTER TABLE "BacklogItem" ADD CONSTRAINT "BacklogItem_outcomeSource_closed_set" CHECK (
  ("outcome" IS NULL AND "outcomeSource" IS NULL)
  OR ("outcome" IS NOT NULL AND "outcomeSource" IN ('stated', 'derived'))
);

-- WWMD DI-19ED69C312FC: an outcome observation is about one backlog item's own
-- outcome. Nullable: observations about a business Product's measure carry no
-- item. SET NULL keeps the observation if the item row is ever removed.
ALTER TABLE "ProductOutcomeObservation" ADD COLUMN "backlogItemId" TEXT;

-- @migration-safety: data-safe: the column is added by this migration, so every existing row holds NULL, which a foreign key allows.
ALTER TABLE "ProductOutcomeObservation"
  ADD CONSTRAINT "ProductOutcomeObservation_backlogItemId_fkey"
  FOREIGN KEY ("backlogItemId") REFERENCES "BacklogItem"("id") ON DELETE SET NULL ON UPDATE CASCADE;

CREATE INDEX "ProductOutcomeObservation_backlogItemId_idx"
  ON "ProductOutcomeObservation"("backlogItemId");
