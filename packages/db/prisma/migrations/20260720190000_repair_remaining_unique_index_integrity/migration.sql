-- BI-63D490FD — repair the finite remainder of simple unique-index/heap
-- divergence found by the contributor sanitized-clone acceptance sweep.
--
-- Fleet safety: every conflicting row is retained under a collision-checked
-- reserved key. Natural-key foreign keys are detached before loser keys move,
-- preventing ON UPDATE CASCADE from stealing references from the canonical
-- survivor. Clean installs change no data; the migration is idempotent.
-- @migration-safety: data-safe: these eight foreign keys already exist on every migrated install; the migration temporarily detaches and restores their exact definitions, never changes a child key, and preserves one canonical parent row under every referenced natural key

BEGIN;

SET LOCAL enable_indexscan = off;
SET LOCAL enable_indexonlyscan = off;
SET LOCAL enable_bitmapscan = off;

ALTER TABLE "CoworkerCapabilityNeed" DROP CONSTRAINT IF EXISTS "CoworkerCapabilityNeed_agentId_fkey";
ALTER TABLE "CoworkerEngagement" DROP CONSTRAINT IF EXISTS "CoworkerEngagement_providerAgentId_fkey";
ALTER TABLE "CoworkerSelfAssessment" DROP CONSTRAINT IF EXISTS "CoworkerSelfAssessment_agentId_fkey";
ALTER TABLE "CoworkerService" DROP CONSTRAINT IF EXISTS "CoworkerService_providerAgentId_fkey";
ALTER TABLE "SkillAssignment" DROP CONSTRAINT IF EXISTS "SkillAssignment_skillId_fkey";
ALTER TABLE "SkillMetric" DROP CONSTRAINT IF EXISTS "SkillMetric_skillId_fkey";
ALTER TABLE "SkillRevision" DROP CONSTRAINT IF EXISTS "SkillRevision_skillId_fkey";
ALTER TABLE "SkillUsageEvent" DROP CONSTRAINT IF EXISTS "SkillUsageEvent_skillId_fkey";

CREATE OR REPLACE FUNCTION pg_temp.dpf_quarantine_duplicate_keys(
  table_name TEXT,
  quarantine_column TEXT,
  partition_expression TEXT,
  survivor_order TEXT
) RETURNS VOID
LANGUAGE plpgsql
AS $$
DECLARE
  duplicate_row RECORD;
  quarantine_key TEXT;
  collision_exists BOOLEAN;
BEGIN
  FOR duplicate_row IN EXECUTE format(
    'WITH ranked AS MATERIALIZED (
       SELECT id, %1$I AS original_key,
              row_number() OVER (PARTITION BY %2$s ORDER BY %3$s) AS duplicate_rank
       FROM %4$I
     )
     SELECT id, original_key FROM ranked
     WHERE duplicate_rank > 1
     ORDER BY original_key, id',
    quarantine_column,
    partition_expression,
    survivor_order,
    table_name
  ) LOOP
    quarantine_key := '__dpf_quarantined__' || duplicate_row.id || '__' || duplicate_row.original_key;
    LOOP
      EXECUTE format(
        'SELECT EXISTS (SELECT 1 FROM %1$I WHERE %2$I = $1 AND id <> $2)',
        table_name,
        quarantine_column
      ) INTO collision_exists USING quarantine_key, duplicate_row.id;
      EXIT WHEN NOT collision_exists;
      quarantine_key := quarantine_key || '_';
    END LOOP;

    EXECUTE format('UPDATE %1$I SET %2$I = $1 WHERE id = $2', table_name, quarantine_column)
      USING quarantine_key, duplicate_row.id;
  END LOOP;
END;
$$;

-- Seeded coworker identity: retain the oldest stable id.
SELECT pg_temp.dpf_quarantine_duplicate_keys(
  'Agent', 'agentId', '"agentId"', '"createdAt" ASC, id ASC'
);

-- Discovery state: retain the most recently observed row.
SELECT pg_temp.dpf_quarantine_duplicate_keys(
  'DiscoveredModel', 'modelId', '"providerId", "modelId"',
  '"lastSeenAt" DESC, "discoveredAt" DESC, id DESC'
);

-- Improvement history: retain the freshest, most recurrent signal.
SELECT pg_temp.dpf_quarantine_duplicate_keys(
  'ImprovementSignal', 'sourceId', '"sourceType", "sourceId"',
  '"lastSeenAt" DESC, "recurrenceCount" DESC, "updatedAt" DESC, id DESC'
);

-- Model routing evidence: retain the most recently evaluated profile first.
SELECT pg_temp.dpf_quarantine_duplicate_keys(
  'ModelProfile', 'modelId', '"providerId", "modelId"',
  '"lastEvalAt" DESC NULLS LAST, "evalCount" DESC, "generatedAt" DESC, id DESC'
);

-- Corpus source: retain the freshest retrieved/updated representation.
SELECT pg_temp.dpf_quarantine_duplicate_keys(
  'RawSource', 'sourceKey', '"sourceKey"',
  '"updatedAt" DESC, "createdAt" DESC, id DESC'
);

-- Skill definition must move before assignment, while natural-key FKs are detached.
SELECT pg_temp.dpf_quarantine_duplicate_keys(
  'SkillDefinition', 'skillId', '"skillId"',
  '"updatedAt" DESC, "createdAt" DESC, id DESC'
);

SELECT pg_temp.dpf_quarantine_duplicate_keys(
  'SkillAssignment', 'agentId', '"skillId", "agentId"',
  'enabled DESC, priority DESC, "assignedAt" DESC, id DESC'
);

-- Storefront behavior: retain the freshest archetype definition.
SELECT pg_temp.dpf_quarantine_duplicate_keys(
  'StorefrontArchetype', 'archetypeId', '"archetypeId"',
  '"updatedAt" DESC, "createdAt" DESC, id DESC'
);

-- TaxonomyNode has no timestamps; retain the stable lexical id.
SELECT pg_temp.dpf_quarantine_duplicate_keys(
  'TaxonomyNode', 'nodeId', '"nodeId"', 'id ASC'
);

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM "Agent" GROUP BY "agentId" HAVING count(*) > 1)
    OR EXISTS (SELECT 1 FROM "DiscoveredModel" GROUP BY "providerId", "modelId" HAVING count(*) > 1)
    OR EXISTS (SELECT 1 FROM "ImprovementSignal" GROUP BY "sourceType", "sourceId" HAVING count(*) > 1)
    OR EXISTS (SELECT 1 FROM "ModelProfile" GROUP BY "providerId", "modelId" HAVING count(*) > 1)
    OR EXISTS (SELECT 1 FROM "RawSource" GROUP BY "sourceKey" HAVING count(*) > 1)
    OR EXISTS (SELECT 1 FROM "SkillAssignment" GROUP BY "skillId", "agentId" HAVING count(*) > 1)
    OR EXISTS (SELECT 1 FROM "SkillDefinition" GROUP BY "skillId" HAVING count(*) > 1)
    OR EXISTS (SELECT 1 FROM "StorefrontArchetype" GROUP BY "archetypeId" HAVING count(*) > 1)
    OR EXISTS (SELECT 1 FROM "TaxonomyNode" GROUP BY "nodeId" HAVING count(*) > 1)
  THEN
    RAISE EXCEPTION 'remaining unique-index integrity repair left duplicate keys';
  END IF;
END $$;

DROP INDEX IF EXISTS "Agent_agentId_key";
DROP INDEX IF EXISTS "DiscoveredModel_providerId_modelId_key";
DROP INDEX IF EXISTS "ImprovementSignal_sourceType_sourceId_key";
DROP INDEX IF EXISTS "ModelProfile_providerId_modelId_key";
DROP INDEX IF EXISTS "RawSource_sourceKey_key";
DROP INDEX IF EXISTS "SkillAssignment_skillId_agentId_key";
DROP INDEX IF EXISTS "SkillDefinition_skillId_key";
DROP INDEX IF EXISTS "StorefrontArchetype_archetypeId_key";
DROP INDEX IF EXISTS "TaxonomyNode_nodeId_key";

CREATE UNIQUE INDEX "Agent_agentId_key" ON "Agent" ("agentId");
CREATE UNIQUE INDEX "DiscoveredModel_providerId_modelId_key" ON "DiscoveredModel" ("providerId", "modelId");
CREATE UNIQUE INDEX "ImprovementSignal_sourceType_sourceId_key" ON "ImprovementSignal" ("sourceType", "sourceId");
CREATE UNIQUE INDEX "ModelProfile_providerId_modelId_key" ON "ModelProfile" ("providerId", "modelId");
CREATE UNIQUE INDEX "RawSource_sourceKey_key" ON "RawSource" ("sourceKey");
CREATE UNIQUE INDEX "SkillAssignment_skillId_agentId_key" ON "SkillAssignment" ("skillId", "agentId");
CREATE UNIQUE INDEX "SkillDefinition_skillId_key" ON "SkillDefinition" ("skillId");
CREATE UNIQUE INDEX "StorefrontArchetype_archetypeId_key" ON "StorefrontArchetype" ("archetypeId");
CREATE UNIQUE INDEX "TaxonomyNode_nodeId_key" ON "TaxonomyNode" ("nodeId");

ALTER TABLE "CoworkerCapabilityNeed"
  ADD CONSTRAINT "CoworkerCapabilityNeed_agentId_fkey"
  FOREIGN KEY ("agentId") REFERENCES "Agent"("agentId") ON UPDATE CASCADE ON DELETE CASCADE;
ALTER TABLE "CoworkerEngagement"
  ADD CONSTRAINT "CoworkerEngagement_providerAgentId_fkey"
  FOREIGN KEY ("providerAgentId") REFERENCES "Agent"("agentId") ON UPDATE CASCADE ON DELETE RESTRICT;
ALTER TABLE "CoworkerSelfAssessment"
  ADD CONSTRAINT "CoworkerSelfAssessment_agentId_fkey"
  FOREIGN KEY ("agentId") REFERENCES "Agent"("agentId") ON UPDATE CASCADE ON DELETE CASCADE;
ALTER TABLE "CoworkerService"
  ADD CONSTRAINT "CoworkerService_providerAgentId_fkey"
  FOREIGN KEY ("providerAgentId") REFERENCES "Agent"("agentId") ON UPDATE CASCADE ON DELETE CASCADE;
ALTER TABLE "SkillAssignment"
  ADD CONSTRAINT "SkillAssignment_skillId_fkey"
  FOREIGN KEY ("skillId") REFERENCES "SkillDefinition"("skillId") ON UPDATE CASCADE ON DELETE CASCADE;
ALTER TABLE "SkillMetric"
  ADD CONSTRAINT "SkillMetric_skillId_fkey"
  FOREIGN KEY ("skillId") REFERENCES "SkillDefinition"("skillId") ON UPDATE CASCADE ON DELETE CASCADE;
ALTER TABLE "SkillRevision"
  ADD CONSTRAINT "SkillRevision_skillId_fkey"
  FOREIGN KEY ("skillId") REFERENCES "SkillDefinition"("skillId") ON UPDATE CASCADE ON DELETE CASCADE;
ALTER TABLE "SkillUsageEvent"
  ADD CONSTRAINT "SkillUsageEvent_skillId_fkey"
  FOREIGN KEY ("skillId") REFERENCES "SkillDefinition"("skillId") ON UPDATE CASCADE ON DELETE CASCADE;

COMMIT;
