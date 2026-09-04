-- BI-9252B9EA, D2 of EP-862820FD: which employment jurisdiction governs a worker.
--
-- A worker's governing jurisdiction was unresolvable: WorkLocation carried
-- locationType, timezone and an optional Address, and no column anywhere on the
-- worker path said which employment rules apply. Without it the co-employment
-- control (BI-B506AD2E) has nothing to look a rule up by, because
-- RegulatoryAutonomyPolicy is keyed on jurisdiction.
--
-- The column holds a PROFESSION_JURISDICTIONS slug ("global" | "us" | "eu" |
-- "uk") - the same closed vocabulary Organization.employsIn already carries and
-- the same one RegulatoryAutonomyPolicy.jurisdiction is keyed on. It is a String
-- for exactly that reason: both existing homes of this vocabulary are Strings,
-- so an enum here would be a third representation needing a cast at every policy
-- lookup, which is the translation layer AC-ELA-004 forbids. The closed set is
-- enforced in TypeScript by isProfessionJurisdiction, and a value outside it
-- resolves to the typed reason "jurisdiction-not-recognised" rather than being
-- passed through to a policy lookup.
--
-- BACKFILL: deliberately none. Every existing row stays NULL and surfaces as
-- operator work naming its reason. A location is NOT assigned a jurisdiction by
-- inference from its address, its timezone, or the organisation's first
-- employsIn entry, and NOT defaulted to "global". "global" is a real member of
-- the vocabulary, so a policy lookup against it would succeed and return the
-- permissive floor - the system would then apply the wrong jurisdiction's
-- employment rules with no signal that it had guessed. An honest unresolved
-- state is better than a confidently wrong legal answer.
--
-- Applies cleanly against any existing data state: the column is nullable with
-- no default, so no existing row is rewritten and no constraint can fail.

ALTER TABLE "WorkLocation" ADD COLUMN "jurisdictionSlug" TEXT;

CREATE INDEX "WorkLocation_jurisdictionSlug_idx" ON "WorkLocation"("jurisdictionSlug");
