-- BI-F5F2869D — backfill cross-domain topic tags onto owner rulings.
--
-- `isMaterialApplicable` now matches additively over `domains[]`, and
-- `promoteStanceMaterial` tags NEW `ruled` material with the cross-domain tag.
-- Existing rulings were written before that and carry only their own
-- domainClass, so on an established install the owner's prior rulings stay
-- invisible to any question bucketed differently — exactly the defect the
-- change fixes. This backfills them.
--
-- Scope is deliberately narrow: only `ruled`-tier stance material (evidenceGrade
-- A at full confidence weight), i.e. a human ruling on a real decision. Lower
-- tiers keep their own domain scope; this does not widen archetype defaults or
-- owner settings confirmations.
--
-- Idempotent: skips rows that already carry the tag.

UPDATE "PerspectiveMaterial"
SET "domains" = array_append("domains", 'all-business-domains')
WHERE "sourceType" = 'stance'
  AND "evidenceGrade" = 'A'
  AND "confidenceWeight" >= 1.0
  AND "promotionState" = 'promoted'
  AND "reviewStatus" = 'approved'
  AND NOT ('all-business-domains' = ANY("domains"));
