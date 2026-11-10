-- Obligation.retentionMinimumDays / retentionFloorBuckets (EP-A33A5C61 slice 6,
-- BI-69C29492). The retention sweep's floors were a hardcoded industry table;
-- the compliance plane already knows which regulations apply to this install by
-- archetype AND jurisdiction, but no Obligation could state a retention
-- duration as a number — only as prose in `description`. These two columns are
-- that missing datum.

ALTER TABLE "Obligation" ADD COLUMN "retentionMinimumDays" INTEGER;
ALTER TABLE "Obligation" ADD COLUMN "retentionFloorBuckets" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[];

-- @migration-safety: data-safe: both columns are additive. retentionMinimumDays
-- is NULL on every existing row (meaning "states no retention minimum", which is
-- true of every obligation seeded before this migration) and
-- retentionFloorBuckets defaults to the empty array, so no existing row changes
-- meaning and no floor moves until a seed populates a value. Floors only ever
-- lengthen a window, so a NULL can never shorten retention.
