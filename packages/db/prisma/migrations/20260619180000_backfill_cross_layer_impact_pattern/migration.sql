-- Backfill the `cross_layer_impact` EA traversal pattern onto EXISTING installs.
--
-- The pattern is seeded for fresh installs by packages/db/src/seed-ea-archimate4.ts
-- (PR #2104), but seed data does not reliably re-apply on self-upgrade (seed.ts tolerates
-- partial failure), so existing installs never received it. `migrate deploy` runs
-- reliably (and before the seed) on every deploy, so this idempotent data migration is
-- the correct backfill per the seed+migration convention.
--
-- Effect: lets run_traversal_pattern("cross_layer_impact", [<data-model element>]) walk the
-- Parity Engine cross-layer `traces` edges from a Prisma-model element to the ACTUAL
-- operational/network/integration elements that realize it. EP-ARCH-GRAPH-LIVE / BI-4A73ED94.
--
-- Idempotent: ON CONFLICT on the (notationId, slug) unique key; a no-op if the archimate4
-- notation is absent (the SELECT yields no rows) or the pattern already exists. Steps and
-- forbiddenShortcuts mirror the seed so fresh installs (which run both) converge identically.
INSERT INTO "EaTraversalPattern"
  ("id", "notationId", "slug", "name", "description", "patternType", "steps", "forbiddenShortcuts", "status", "createdAt", "updatedAt")
SELECT
  gen_random_uuid()::text,
  n."id",
  'cross_layer_impact',
  'Cross-Layer Data-Model Impact',
  'From a data-model element, trace the actual operational, network, and integration elements that realize it via the Parity Engine cross-layer traces edges - the cross-layer blast radius of a data-model change.',
  'cross_layer_impact',
  '[{"elementTypeSlugs":["part_usage","part_definition"],"refinementLevel":null,"relationshipTypeSlugs":["traces"],"direction":"inbound"},{"elementTypeSlugs":["part_usage","part_definition"],"refinementLevel":null,"relationshipTypeSlugs":[],"direction":"terminal"}]'::jsonb,
  '["A data-model element''s cross-layer impact is the ACTUAL elements that trace to it, not other data-model elements","A traces edge records that an actual element is an occurrence of the model type - it is not a runtime dependency","These cross-layer edges are derived by the Parity Engine bridges, not hand-authored - verify against the live projection"]'::jsonb,
  'active',
  now(),
  now()
FROM "EaNotation" n
WHERE n."slug" = 'archimate4'
ON CONFLICT ("notationId", "slug") DO NOTHING;
