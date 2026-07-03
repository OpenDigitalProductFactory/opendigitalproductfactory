-- Data-only backfill for the data-driven applicability rollout.
--
-- The prior migration added Regulation.applicability (nullable). Phase 1 removes
-- the bespoke classifiers (classifyCada, classifyUkCorpGov), so on an EXISTING
-- install the already-seeded REG-CADA-2026 / REG-UK-CORP-GOV-CODE rows would sit
-- with applicability = NULL between deploy and the next seed run and fall back to
-- the industry matcher (mis-classifying). Backfill both rows here so the correct
-- classification is in effect the instant this migration applies — independent of
-- seed timing.
--
-- Guarded on IS NULL: a later seed upsert or an operator edit stays authoritative,
-- and this is a no-op on a fresh install (the rows are seeded after migrations, so
-- 0 rows match here and the seed populates the spec).
UPDATE "Regulation"
   SET "applicability" = '{"basis":["operating","selling"],"jurisdictions":["eu"]}'::jsonb
 WHERE "regulationId" = 'REG-CADA-2026' AND "applicability" IS NULL;

UPDATE "Regulation"
   SET "applicability" = '{"basis":["operating"],"jurisdictions":["uk"],"listingStatuses":["premium-listed"]}'::jsonb
 WHERE "regulationId" = 'REG-UK-CORP-GOV-CODE' AND "applicability" IS NULL;
