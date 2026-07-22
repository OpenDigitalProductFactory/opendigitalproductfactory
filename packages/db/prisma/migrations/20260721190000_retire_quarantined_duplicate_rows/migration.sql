-- BI-8CCF7F13 — retire the duplicate rows that the collation-drift dedupe
-- quarantined but left ACTIVE.
--
-- Context. The generic dedupe migration 20260720193000 resolved the corrupted
-- unique indexes by renaming each loser row's key to a `__dpf_quarantined__…`
-- value and rebuilding the index. That restored index integrity, but the helper
-- is table-agnostic: it renames the key column and nothing else. It does not
-- know each table's own "this row is no longer live" markers, so every
-- quarantined loser was left with its original status/lifecycle intact.
--
-- The visible consequence is the exact symptom that opened this investigation.
-- The coworker roster (apps/web/lib/coworker-record/roster.ts) filters on
-- `archived = false AND lifecycleStage <> 'retirement'`. A quarantined Agent row
-- keeps `archived = false`, `lifecycleStage = 'production'`, AND its original
-- `displayName` — so 17 duplicate coworkers ("Customer Advisor", "Digital
-- Product Estate Specialist", …) render again, indistinguishable from the
-- originals. The renamed key hid them from the UNIQUE constraint, not from the
-- user.
--
-- The same is true, less visibly, for the other quarantined tables:
--   * ModelProfile keeps `modelStatus = 'active'` with an intact providerId, so
--     the active-model catalog query
--     (`where: { providerId, modelStatus: { in: ['active','degraded'] } }`,
--     apps/web/lib/inference/model-catalog.ts:513) returns quarantine-keyed
--     phantom models.
--   * A quarantined TaxonomyNode keeps `status = 'active'` and its real parent,
--     so the taxonomy render (`where: { status: 'active' }`,
--     apps/web/lib/business-capabilities/data.ts:77,243) shows a ghost leaf.
--   * SkillDefinition keeps `status = 'active'`.
--
-- This migration marks every quarantined tombstone inactive using each table's
-- OWN native marker (verified present in that column's live domain, so no
-- invented enum value): the rows stay retained per the tombstone merge policy —
-- nothing is deleted — they simply stop rendering as live records. Idempotent
-- and scoped strictly to `__dpf_quarantined__%` keys, so a clean install and a
-- re-run both change nothing.

BEGIN;

-- Agent — the reported symptom. Roster filters archived + lifecycleStage; set
-- both. 'retirement' is the same lifecycleStage the roster already excludes for
-- retired dual-seed alias rows, so this needs no new vocabulary.
UPDATE "Agent"
SET "archived" = true,
    "lifecycleStage" = 'retirement',
    "status" = 'retired'
WHERE "agentId" LIKE '\_\_dpf\_quarantined\_\_%'
  AND ("archived" = false OR "lifecycleStage" <> 'retirement');

-- ModelProfile — 'retired' is already present in the live modelStatus domain
-- (active/degraded/disabled/retired); retiredAt/retiredReason are purpose-built.
UPDATE "ModelProfile"
SET "modelStatus" = 'retired',
    "retiredAt" = COALESCE("retiredAt", now()),
    "retiredReason" = COALESCE("retiredReason",
      'Quarantined duplicate from collation-drift index repair (BI-8CCF7F13)')
WHERE "modelId" LIKE '\_\_dpf\_quarantined\_\_%'
  AND "modelStatus" <> 'retired';

-- TaxonomyNode — the render filters status = 'active'; any other value hides the
-- ghost leaf. status is a free String (no check constraint), so 'retired' is
-- safe and self-describing.
UPDATE "TaxonomyNode"
SET "status" = 'retired'
WHERE "nodeId" LIKE '%\_\_dpf\_quarantined\_\_%'
  AND "status" = 'active';

-- SkillDefinition — 'quarantined' is an app-layer status the skills lifecycle
-- already recognises (apps/web/lib/skills/lifecycle.ts), and is the literal
-- truth of the row.
UPDATE "SkillDefinition"
SET "status" = 'quarantined'
WHERE "skillId" LIKE '%\_\_dpf\_quarantined\_\_%'
  AND "status" <> 'quarantined';

-- Fail closed: no quarantined row may remain marked live on the surfaces above.
DO $$
DECLARE
  live_ghosts int;
BEGIN
  SELECT
    (SELECT count(*) FROM "Agent"
       WHERE "agentId" LIKE '\_\_dpf\_quarantined\_\_%'
         AND ("archived" = false OR "lifecycleStage" <> 'retirement'))
  + (SELECT count(*) FROM "ModelProfile"
       WHERE "modelId" LIKE '\_\_dpf\_quarantined\_\_%' AND "modelStatus" <> 'retired')
  + (SELECT count(*) FROM "TaxonomyNode"
       WHERE "nodeId" LIKE '%\_\_dpf\_quarantined\_\_%' AND "status" = 'active')
  INTO live_ghosts;

  IF live_ghosts > 0 THEN
    RAISE EXCEPTION 'retire-quarantined: % quarantined row(s) still marked live', live_ghosts;
  END IF;
END $$;

COMMIT;
