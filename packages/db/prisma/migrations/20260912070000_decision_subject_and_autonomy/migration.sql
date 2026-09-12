-- BI-01F8F06D. Give a governed decision a subject, and say whether anyone watched it.
--
-- Without these a decision is an isolated event. Of the first 1,093 rows, one
-- carried a buildId and twenty a taskRunId, while the backlog item id lived
-- inside the question prose -- so nothing could join a decision to the work it
-- governed, and no outcome could ever be attributed to it.
--
-- `autonomous` is not telemetry. 518 of those rows were an hourly cron drain
-- with no human in the loop; an agreement rate computed over them would measure
-- nothing while looking authoritative. Marking them keeps them out of any
-- denominator by construction rather than by a filter someone must remember.
--
-- The backfill invents nothing. Both values were already recorded by the
-- platform in the same row's outcomePayload and are moved into the columns that
-- should have held them. A row whose payload carries neither stays NULL/false,
-- which is the honest state. Idempotent: only NULL columns with a present key
-- are touched, so a re-run reports UPDATE 0.

-- `subjectKind` is a typed enum rather than TEXT (AGENTS.md section 8, BI-817ED2D4):
-- it is a brand-new closed set, so it can be born correct instead of being
-- retrofitted with a NOT VALID CHECK the way the long-lived TEXT columns were.
CREATE TYPE "DecisionSubjectKind" AS ENUM ('backlog-item');
ALTER TABLE "DecisionInteraction" ADD COLUMN "subjectKind" "DecisionSubjectKind";
ALTER TABLE "DecisionInteraction" ADD COLUMN "subjectRef" TEXT;
ALTER TABLE "DecisionInteraction" ADD COLUMN "autonomous" BOOLEAN NOT NULL DEFAULT false;

CREATE INDEX "DecisionInteraction_subjectKind_subjectRef_idx"
  ON "DecisionInteraction" ("subjectKind", "subjectRef");
CREATE INDEX "DecisionInteraction_autonomous_idx"
  ON "DecisionInteraction" ("autonomous");

UPDATE "DecisionInteraction"
SET "subjectKind" = 'backlog-item'::"DecisionSubjectKind",
    "subjectRef"  = "outcomePayload" ->> 'backlogItemId'
WHERE "subjectRef" IS NULL
  AND "outcomePayload" ->> 'backlogItemId' IS NOT NULL
  AND length(trim("outcomePayload" ->> 'backlogItemId')) > 0;

UPDATE "DecisionInteraction"
SET "autonomous" = true
WHERE "autonomous" = false
  AND "outcomePayload" ->> 'autonomous' = 'true';
