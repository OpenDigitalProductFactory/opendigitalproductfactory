-- Repair corrupted designDoc evidence records where required fields were saved
-- as the string "undefined" or are absent. Root cause: saveBuildEvidence tool
-- had wrong example field names (summary/approach) instead of the canonical
-- names (problemStatement/proposedApproach). The review prompt inline-templated
-- these fields, so undefined values became the literal string "undefined" in
-- the review input and every review failed, causing an infinite retry loop.
--
-- This migration nullifies any designDoc where problemStatement is missing or
-- is the string "undefined" so the coworker is forced to re-save a valid doc.
-- The buildArtifactRevision rows are left intact for audit purposes.

UPDATE "FeatureBuild"
SET "designDoc" = NULL
WHERE "designDoc" IS NOT NULL
  AND (
    "designDoc" ->> 'problemStatement' IS NULL
    OR "designDoc" ->> 'problemStatement' = 'undefined'
    OR "designDoc" ->> 'proposedApproach' = 'undefined'
    OR "designDoc" ->> 'reusePlan' = 'undefined'
  );
