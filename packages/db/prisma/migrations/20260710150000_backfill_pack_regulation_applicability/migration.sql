-- Data-only backfill: archetype-scoped applicability for the wholesale-seeded
-- industry compliance packs (BI-9DED0CE8).
--
-- The banking / public-sector / law-enforcement / cooperative packs seed into
-- every install but carried no structured applicability spec, so they fell back
-- to the legacy industry string matcher and every install saw all packs as
-- potential obligations (noise). The pack seeds now carry data-driven specs;
-- on an EXISTING install the already-seeded rows would sit with
-- applicability = NULL between deploy and the next seed run. Backfill them here
-- so archetype-scoped classification is in effect the instant this migration
-- applies — independent of seed timing (same pattern as
-- 20260703170000_backfill_regulation_applicability).
--
-- Guarded on IS NULL: a later seed upsert or an operator edit stays
-- authoritative, and this is a no-op on a fresh install (rows are seeded after
-- migrations, so 0 rows match here and the seed populates the spec).

-- Banking pack: BSA/AML binds the whole banking-financial-services category;
-- NCUA binds only a credit union; FDIC/CRA binds only a community bank.
UPDATE "Regulation"
   SET "applicability" = '{"basis":["operating"],"jurisdictions":["us"],"archetypes":["banking-financial-services"]}'::jsonb
 WHERE "regulationId" = 'REG-US-BSA-AML' AND "applicability" IS NULL;

UPDATE "Regulation"
   SET "applicability" = '{"basis":["operating"],"jurisdictions":["us"],"archetypes":["credit-union"]}'::jsonb
 WHERE "regulationId" = 'REG-US-NCUA' AND "applicability" IS NULL;

UPDATE "Regulation"
   SET "applicability" = '{"basis":["operating"],"jurisdictions":["us"],"archetypes":["community-bank"]}'::jsonb
 WHERE "regulationId" = 'REG-US-FDIC-CRA' AND "applicability" IS NULL;

-- Public-sector pack: open-meetings / public-records bind every public body
-- (category); municipal finance and the EPA water regimes bind only the
-- archetypes that run a municipality or a water/wastewater system.
UPDATE "Regulation"
   SET "applicability" = '{"basis":["operating"],"jurisdictions":["us"],"archetypes":["public-sector"]}'::jsonb
 WHERE "regulationId" IN ('REG-US-STATE-OPEN-MEETINGS', 'REG-US-STATE-PUBLIC-RECORDS')
   AND "applicability" IS NULL;

UPDATE "Regulation"
   SET "applicability" = '{"basis":["operating"],"jurisdictions":["us"],"archetypes":["small-town-municipality","municipal-utility"]}'::jsonb
 WHERE "regulationId" IN ('REG-US-STATE-MUNI-FINANCE', 'REG-US-EPA-SDWA', 'REG-US-EPA-NPDES')
   AND "applicability" IS NULL;

-- Law-enforcement pack: binds only the law-enforcement-agency archetype id
-- (its category is public-sector, so the public-body pack also applies to it).
UPDATE "Regulation"
   SET "applicability" = '{"basis":["operating"],"jurisdictions":["us"],"archetypes":["law-enforcement-agency"]}'::jsonb
 WHERE "regulationId" IN ('REG-US-STATE-POST', 'REG-US-LE-POLICY-ATTESTATION', 'REG-US-CJIS-READINESS')
   AND "applicability" IS NULL;

-- Cooperative pack: binds the cooperative archetype ids; credit unions are NOT
-- in scope (exempt from Subchapter T — they answer to the NCUA regime).
UPDATE "Regulation"
   SET "applicability" = '{"basis":["operating"],"jurisdictions":["us"],"archetypes":["cooperative","agricultural-cooperative"]}'::jsonb
 WHERE "regulationId" IN ('REG-US-IRS-SUBCHAPTER-T', 'REG-US-COOP-GOVERNANCE')
   AND "applicability" IS NULL;
