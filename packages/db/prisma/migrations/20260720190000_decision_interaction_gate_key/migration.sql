-- BI-1BE30A9A: the decision-log audit tier derived purely from the
-- fallback-resolved profile kind, so a profession/WSID decision whose doctrine
-- fell back to platform material persisted as profileId='mark-dpf-platform'
-- and surfaced under WWMD. The WSID tier therefore reads empty even when the
-- profession gate runs, and the operator concludes the gate is never called.
--
-- Record the gate that actually produced the row, and tier on that.

ALTER TABLE "DecisionInteraction"
  ADD COLUMN "gateKey" TEXT,
  ADD COLUMN "gateFallbackUsed" BOOLEAN NOT NULL DEFAULT false;

-- Backfill: existing rows predate the column. Their gate is recoverable from
-- the profile kind, which for these rows was NOT distorted by fallback --
-- the profession gate has never run (0 rows of kind 'profession'), so every
-- historical row genuinely belongs to the tier its profile kind implies.
UPDATE "DecisionInteraction" d
SET "gateKey" = CASE p."kind"
    WHEN 'platform'     THEN 'build-studio'
    WHEN 'organization' THEN 'org-business'
    WHEN 'profession'   THEN 'profession'
  END
FROM "DecisionPerspectiveProfile" p
WHERE p."profileId" = d."profileId"
  AND p."kind" IN ('platform', 'organization', 'profession');

CREATE INDEX "DecisionInteraction_gateKey_createdAt_idx"
  ON "DecisionInteraction" ("gateKey", "createdAt");
