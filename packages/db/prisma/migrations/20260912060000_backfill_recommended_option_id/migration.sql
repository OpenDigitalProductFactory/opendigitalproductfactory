-- BI-F302B80E. Promote already-recorded kernel recommendations into their own column.
--
-- `DecisionInteraction.recommendedOptionId` is the indexed home for the kernel's
-- pick. The kernel-consult writer set it only inside `outcomePayload` JSON and
-- the seal payload, never on the column, so 152 of 1,080 governed decisions
-- recorded a recommendation that nothing could select. Agreement cannot be
-- measured against a value that is not queryable.
--
-- This is NOT inventing an outcome. Every value below was recorded by the
-- platform at decision time and is simply moved into the column that was always
-- meant to hold it. Rows that recorded no recommendation stay NULL, which is the
-- honest state for a decision where the kernel reached no pick.
--
-- Idempotent and safe to re-run: the WHERE clause only touches rows whose column
-- is still NULL while their payload carries a value.

UPDATE "DecisionInteraction"
SET "recommendedOptionId" = "outcomePayload" ->> 'recommendedOptionId'
WHERE "recommendedOptionId" IS NULL
  AND "outcomePayload" ->> 'recommendedOptionId' IS NOT NULL
  AND length(trim("outcomePayload" ->> 'recommendedOptionId')) > 0;
