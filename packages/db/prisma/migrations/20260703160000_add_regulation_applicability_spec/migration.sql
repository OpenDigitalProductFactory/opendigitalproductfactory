-- Data-driven applicability spec for governance requirements. Stores a
-- serialized RegulationApplicability ({ basis[], jurisdictions[], archetypes?,
-- listingStatuses? }) so the generic evaluator classifies a regulation for an
-- install with no per-regulation code. Nullable + no default: existing rows
-- fall back to the legacy jurisdiction/industry string matcher until backfilled.
ALTER TABLE "Regulation" ADD COLUMN "applicability" JSONB;
