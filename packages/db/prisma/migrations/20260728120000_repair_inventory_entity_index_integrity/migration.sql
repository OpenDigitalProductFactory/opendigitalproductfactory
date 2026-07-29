-- BI-CF4ADDAC - repair InventoryEntity heap/index divergence caused by the
-- measured musl-to-glibc collation transition. The damaged unique index could
-- miss heap rows during upsert and also fail to reject a second copy.
--
-- @migration-safety: remediates-existing-data: duplicate entity and projected
-- relationship groups are converged before either unique contract is rebuilt.
--
-- Fleet contract:
--   * no InventoryEntity or InventoryRelationship row is deleted;
--   * duplicate losers remain superseded tombstones with merge lineage;
--   * every hard and declared soft reference is repointed;
--   * ownership/mastered-identity disagreements fail and roll back;
--   * clean installs and a second execution change no row data.

BEGIN;

SET LOCAL lock_timeout = '30s';
SET LOCAL enable_indexscan = off;
SET LOCAL enable_indexonlyscan = off;
SET LOCAL enable_bitmapscan = off;

-- Provisioned here so every later integrity check can remain read-only.
CREATE EXTENSION IF NOT EXISTS amcheck WITH SCHEMA public;

ALTER TABLE "InventoryEntity"
  ADD COLUMN IF NOT EXISTS "mergedIntoId" TEXT;
ALTER TABLE "InventoryRelationship"
  ADD COLUMN IF NOT EXISTS "mergedIntoId" TEXT;

-- Fixed lock order. SHARE ROW EXCLUSIVE blocks concurrent writers while still
-- allowing ordinary reads during the bounded self-upgrade migration window.
LOCK TABLE
  "ChangeItem",
  "DiscoveredItem",
  "DiscoveredRelationship",
  "DiscoveredSoftwareEvidence",
  "DiscoveryConnection",
  "DiscoveryFingerprintObservation",
  "DiscoveryTriageDecision",
  "IdentityResolutionLog",
  "InventoryEntity",
  "InventoryRelationship",
  "PortfolioQualityIssue",
  "RemoteAction"
IN SHARE ROW EXCLUSIVE MODE;

-- Never let the untrustworthy comparator participate in survivor discovery.
DROP INDEX IF EXISTS "InventoryEntity_entityKey_key";

CREATE TEMP TABLE _dpf_entity_merge_map (
  loser_id TEXT PRIMARY KEY,
  survivor_id TEXT NOT NULL,
  original_key TEXT NOT NULL,
  quarantine_key TEXT
) ON COMMIT DROP;

INSERT INTO _dpf_entity_merge_map (loser_id, survivor_id, original_key)
WITH ranked AS (
  SELECT
    e.id,
    e."entityKey",
    first_value(e.id) OVER (
      PARTITION BY e."entityKey"
      ORDER BY e."firstSeenAt", e.id
    ) AS survivor_id,
    count(*) OVER (PARTITION BY e."entityKey") AS copies
  FROM "InventoryEntity" e
)
SELECT id, survivor_id, "entityKey"
FROM ranked
WHERE copies > 1
  AND id <> survivor_id;

-- Refuse to infer equivalence across ownership or mastered-identity boundaries.
DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM "InventoryEntity" e
    WHERE EXISTS (
      SELECT 1
      FROM _dpf_entity_merge_map m
      WHERE m.original_key = e."entityKey"
    )
    GROUP BY e."entityKey"
    HAVING
      count(DISTINCT e."entityType") > 1
      OR count(DISTINCT e."scopeKey")
           + CASE WHEN bool_or(e."scopeKey" IS NULL) THEN 1 ELSE 0 END > 1
      OR count(DISTINCT e."customerAccountId")
           + CASE WHEN bool_or(e."customerAccountId" IS NULL) THEN 1 ELSE 0 END > 1
      OR count(DISTINCT e."customerSiteId")
           + CASE WHEN bool_or(e."customerSiteId" IS NULL) THEN 1 ELSE 0 END > 1
      OR count(DISTINCT e."portfolioId") > 1
      OR count(DISTINCT e."digitalProductId") > 1
      OR count(DISTINCT e."taxonomyNodeId") > 1
      OR count(DISTINCT e."catalogIdentityId") FILTER (
        WHERE e."identityStatus" IN ('human_confirmed', 'human_corrected')
      ) > 1
  ) THEN
    RAISE EXCEPTION
      'InventoryEntity integrity repair stopped: duplicate key crosses scope, ownership, or mastered identity';
  END IF;
END $$;

-- Pick the first collision-free reserved key. The loser id makes candidates
-- mutually distinct; the suffix handles a pre-existing reserved-name row.
WITH candidates AS (
  SELECT
    m.loser_id,
    candidate.quarantine_key
  FROM _dpf_entity_merge_map m
  CROSS JOIN LATERAL (
    SELECT
      '__dpf_quarantined__' || m.loser_id || '__' || m.original_key
        || repeat('_', series.n) AS quarantine_key
    FROM generate_series(0, 1000) AS series(n)
    WHERE NOT EXISTS (
      SELECT 1
      FROM "InventoryEntity" existing
      WHERE existing."entityKey" =
        '__dpf_quarantined__' || m.loser_id || '__' || m.original_key
          || repeat('_', series.n)
    )
    ORDER BY series.n
    LIMIT 1
  ) candidate
)
UPDATE _dpf_entity_merge_map m
SET quarantine_key = candidates.quarantine_key
FROM candidates
WHERE candidates.loser_id = m.loser_id;

DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM _dpf_entity_merge_map WHERE quarantine_key IS NULL
  ) THEN
    RAISE EXCEPTION 'InventoryEntity integrity repair could not allocate a quarantine key';
  END IF;
END $$;

CREATE TEMP TABLE _dpf_entity_members (
  entity_id TEXT PRIMARY KEY,
  survivor_id TEXT NOT NULL
) ON COMMIT DROP;

INSERT INTO _dpf_entity_members (entity_id, survivor_id)
SELECT loser_id, survivor_id FROM _dpf_entity_merge_map
UNION
SELECT survivor_id, survivor_id FROM _dpf_entity_merge_map;

CREATE TEMP TABLE _dpf_entity_rollup ON COMMIT DROP AS
SELECT
  members.survivor_id,
  min(e."firstSeenAt") AS first_seen_at,
  max(e."lastSeenAt") AS last_seen_at,
  (array_agg(e."lastConfirmedRunId" ORDER BY e."lastSeenAt" DESC, e.id DESC)
    FILTER (WHERE e."lastConfirmedRunId" IS NOT NULL))[1] AS last_confirmed_run_id,
  (array_agg(e."technicalClass" ORDER BY e."lastSeenAt" DESC, e.id DESC)
    FILTER (WHERE e."technicalClass" IS NOT NULL))[1] AS technical_class,
  (array_agg(e."iconKey" ORDER BY e."lastSeenAt" DESC, e.id DESC)
    FILTER (WHERE e."iconKey" IS NOT NULL))[1] AS icon_key,
  (array_agg(e.manufacturer ORDER BY e."lastSeenAt" DESC, e.id DESC)
    FILTER (WHERE e.manufacturer IS NOT NULL))[1] AS manufacturer,
  (array_agg(e."productModel" ORDER BY e."lastSeenAt" DESC, e.id DESC)
    FILTER (WHERE e."productModel" IS NOT NULL))[1] AS product_model,
  (array_agg(e."observedVersion" ORDER BY e."lastSeenAt" DESC, e.id DESC)
    FILTER (WHERE e."observedVersion" IS NOT NULL))[1] AS observed_version,
  (array_agg(e."normalizedVersion" ORDER BY e."lastSeenAt" DESC, e.id DESC)
    FILTER (WHERE e."normalizedVersion" IS NOT NULL))[1] AS normalized_version,
  (array_agg(e."supportStatus" ORDER BY e."lastSeenAt" DESC, e.id DESC)
    FILTER (WHERE e."supportStatus" <> 'unknown'))[1] AS support_status,
  (array_agg(e."attributionStatus" ORDER BY e."lastSeenAt" DESC, e.id DESC)
    FILTER (WHERE e."attributionStatus" NOT IN ('needs_review', 'unmapped')))[1]
      AS attribution_status,
  (array_agg(e.confidence ORDER BY e."lastSeenAt" DESC, e.id DESC)
    FILTER (WHERE e.confidence IS NOT NULL))[1] AS confidence,
  (array_agg(e."portfolioId" ORDER BY e."lastSeenAt" DESC, e.id DESC)
    FILTER (WHERE e."portfolioId" IS NOT NULL))[1] AS portfolio_id,
  (array_agg(e."taxonomyNodeId" ORDER BY e."lastSeenAt" DESC, e.id DESC)
    FILTER (WHERE e."taxonomyNodeId" IS NOT NULL))[1] AS taxonomy_node_id,
  (array_agg(e."digitalProductId" ORDER BY e."lastSeenAt" DESC, e.id DESC)
    FILTER (WHERE e."digitalProductId" IS NOT NULL))[1] AS digital_product_id,
  (array_agg(e."attributionMethod" ORDER BY e."lastSeenAt" DESC, e.id DESC)
    FILTER (WHERE e."attributionMethod" IS NOT NULL))[1] AS attribution_method,
  (array_agg(e."attributionConfidence" ORDER BY e."lastSeenAt" DESC, e.id DESC)
    FILTER (WHERE e."attributionConfidence" IS NOT NULL))[1] AS attribution_confidence,
  (array_agg(e."attributionEvidence" ORDER BY e."lastSeenAt" DESC, e.id DESC)
    FILTER (WHERE e."attributionEvidence" IS NOT NULL))[1] AS attribution_evidence,
  (array_agg(e."candidateTaxonomy" ORDER BY e."lastSeenAt" DESC, e.id DESC)
    FILTER (WHERE e."candidateTaxonomy" IS NOT NULL))[1] AS candidate_taxonomy,
  (array_agg(e."catalogIdentityId" ORDER BY e."lastSeenAt" DESC, e.id DESC)
    FILTER (WHERE e."catalogIdentityId" IS NOT NULL))[1] AS catalog_identity_id,
  (array_agg(e."identityStatus" ORDER BY
      (e."identityStatus" IN ('human_confirmed', 'human_corrected')) DESC,
      e."lastSeenAt" DESC,
      e.id DESC)
    FILTER (WHERE e."identityStatus" IS NOT NULL))[1] AS identity_status,
  (array_agg(e."identityConfidence" ORDER BY e."lastSeenAt" DESC, e.id DESC)
    FILTER (WHERE e."identityConfidence" IS NOT NULL))[1] AS identity_confidence,
  (array_agg(e."updatePosture" ORDER BY e."lastSeenAt" DESC, e.id DESC)
    FILTER (WHERE e."updatePosture" <> 'unknown'))[1] AS update_posture,
  (array_agg(e."updatePostureSource" ORDER BY e."lastSeenAt" DESC, e.id DESC)
    FILTER (WHERE e."updatePostureSource" IS NOT NULL))[1] AS update_posture_source,
  (array_agg(e."updatePostureConfidence" ORDER BY e."lastSeenAt" DESC, e.id DESC)
    FILTER (WHERE e."updatePostureConfidence" IS NOT NULL))[1] AS update_posture_confidence,
  (array_agg(e."latestKnownVersion" ORDER BY e."lastSeenAt" DESC, e.id DESC)
    FILTER (WHERE e."latestKnownVersion" IS NOT NULL))[1] AS latest_known_version,
  (array_agg(e."supportLifecycleSource" ORDER BY e."lastSeenAt" DESC, e.id DESC)
    FILTER (WHERE e."supportLifecycleSource" IS NOT NULL))[1] AS support_lifecycle_source,
  (array_agg(e."supportLifecycleConfidence" ORDER BY e."lastSeenAt" DESC, e.id DESC)
    FILTER (WHERE e."supportLifecycleConfidence" IS NOT NULL))[1]
      AS support_lifecycle_confidence,
  coalesce((
    SELECT jsonb_object_agg(
      property.key,
      property.value
      ORDER BY observed."lastSeenAt", observed.id
    )
    FROM _dpf_entity_members nested_members
    JOIN "InventoryEntity" observed
      ON observed.id = nested_members.entity_id
    CROSS JOIN LATERAL jsonb_each(observed.properties) property
    WHERE nested_members.survivor_id = members.survivor_id
  ), '{}'::jsonb) AS merged_properties
FROM _dpf_entity_members members
JOIN "InventoryEntity" e ON e.id = members.entity_id
GROUP BY members.survivor_id;

UPDATE "InventoryEntity" survivor
SET
  "technicalClass" = coalesce(survivor."technicalClass", rollup.technical_class),
  "iconKey" = coalesce(survivor."iconKey", rollup.icon_key),
  manufacturer = coalesce(survivor.manufacturer, rollup.manufacturer),
  "productModel" = coalesce(survivor."productModel", rollup.product_model),
  "observedVersion" = coalesce(survivor."observedVersion", rollup.observed_version),
  "normalizedVersion" = coalesce(survivor."normalizedVersion", rollup.normalized_version),
  "supportStatus" = CASE
    WHEN survivor."supportStatus" <> 'unknown' THEN survivor."supportStatus"
    ELSE coalesce(rollup.support_status, survivor."supportStatus")
  END,
  "attributionStatus" = CASE
    WHEN survivor."attributionStatus" NOT IN ('needs_review', 'unmapped')
      THEN survivor."attributionStatus"
    ELSE coalesce(rollup.attribution_status, survivor."attributionStatus")
  END,
  confidence = coalesce(survivor.confidence, rollup.confidence),
  properties = rollup.merged_properties,
  "firstSeenAt" = rollup.first_seen_at,
  "lastSeenAt" = rollup.last_seen_at,
  "lastConfirmedRunId" = coalesce(rollup.last_confirmed_run_id, survivor."lastConfirmedRunId"),
  "portfolioId" = coalesce(survivor."portfolioId", rollup.portfolio_id),
  "taxonomyNodeId" = coalesce(survivor."taxonomyNodeId", rollup.taxonomy_node_id),
  "digitalProductId" = coalesce(survivor."digitalProductId", rollup.digital_product_id),
  "attributionMethod" = coalesce(survivor."attributionMethod", rollup.attribution_method),
  "attributionConfidence" =
    coalesce(survivor."attributionConfidence", rollup.attribution_confidence),
  "attributionEvidence" =
    coalesce(survivor."attributionEvidence", rollup.attribution_evidence),
  "candidateTaxonomy" = coalesce(survivor."candidateTaxonomy", rollup.candidate_taxonomy),
  "catalogIdentityId" = coalesce(survivor."catalogIdentityId", rollup.catalog_identity_id),
  "identityStatus" = CASE
    WHEN survivor."identityStatus" IN ('human_confirmed', 'human_corrected')
      THEN survivor."identityStatus"
    ELSE coalesce(rollup.identity_status, survivor."identityStatus")
  END,
  "identityConfidence" =
    coalesce(survivor."identityConfidence", rollup.identity_confidence),
  "updatePosture" = CASE
    WHEN survivor."updatePosture" <> 'unknown' THEN survivor."updatePosture"
    ELSE coalesce(rollup.update_posture, survivor."updatePosture")
  END,
  "updatePostureSource" =
    coalesce(survivor."updatePostureSource", rollup.update_posture_source),
  "updatePostureConfidence" =
    coalesce(survivor."updatePostureConfidence", rollup.update_posture_confidence),
  "latestKnownVersion" =
    coalesce(survivor."latestKnownVersion", rollup.latest_known_version),
  "supportLifecycleSource" =
    coalesce(survivor."supportLifecycleSource", rollup.support_lifecycle_source),
  "supportLifecycleConfidence" =
    coalesce(survivor."supportLifecycleConfidence", rollup.support_lifecycle_confidence)
FROM _dpf_entity_rollup rollup
WHERE survivor.id = rollup.survivor_id;

-- Build relationship projections before changing any endpoint or entity key.
CREATE TEMP TABLE _dpf_relationship_projection ON COMMIT DROP AS
SELECT
  relationship.id,
  relationship."fromEntityId" AS original_from_id,
  relationship."toEntityId" AS original_to_id,
  coalesce(from_map.survivor_id, relationship."fromEntityId") AS future_from_id,
  coalesce(to_map.survivor_id, relationship."toEntityId") AS future_to_id,
  relationship."relationshipType",
  (
    relationship."fromEntityId" <> relationship."toEntityId"
    AND coalesce(from_map.survivor_id, relationship."fromEntityId")
      = coalesce(to_map.survivor_id, relationship."toEntityId")
  ) AS self_loop_after_merge
FROM "InventoryRelationship" relationship
LEFT JOIN _dpf_entity_merge_map from_map
  ON from_map.loser_id = relationship."fromEntityId"
LEFT JOIN _dpf_entity_merge_map to_map
  ON to_map.loser_id = relationship."toEntityId";

DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM _dpf_relationship_projection projection
    JOIN "InventoryRelationship" relationship ON relationship.id = projection.id
    WHERE NOT projection.self_loop_after_merge
      AND relationship."mergedIntoId" IS NULL
      AND relationship.status <> 'superseded'
    GROUP BY
      projection.future_from_id,
      projection.future_to_id,
      projection."relationshipType"
    HAVING
      count(DISTINCT relationship."scopeKey")
        + CASE WHEN bool_or(relationship."scopeKey" IS NULL) THEN 1 ELSE 0 END > 1
      OR count(DISTINCT relationship."customerAccountId")
        + CASE WHEN bool_or(relationship."customerAccountId" IS NULL) THEN 1 ELSE 0 END > 1
      OR count(DISTINCT relationship."customerSiteId")
        + CASE WHEN bool_or(relationship."customerSiteId" IS NULL) THEN 1 ELSE 0 END > 1
  ) THEN
    RAISE EXCEPTION
      'InventoryRelationship integrity repair stopped: projected tuple crosses scope or ownership';
  END IF;
END $$;

CREATE TEMP TABLE _dpf_relationship_merge_map (
  loser_id TEXT PRIMARY KEY,
  survivor_id TEXT NOT NULL
) ON COMMIT DROP;

INSERT INTO _dpf_relationship_merge_map (loser_id, survivor_id)
WITH ranked AS (
  SELECT
    relationship.id,
    first_value(relationship.id) OVER (
      PARTITION BY
        projection.future_from_id,
        projection.future_to_id,
        projection."relationshipType"
      ORDER BY
        (
          relationship."fromEntityId" = projection.future_from_id
          AND relationship."toEntityId" = projection.future_to_id
        ) DESC,
        relationship."firstSeenAt",
        relationship.id
    ) AS survivor_id,
    count(*) OVER (
      PARTITION BY
        projection.future_from_id,
        projection.future_to_id,
        projection."relationshipType"
    ) AS copies
  FROM _dpf_relationship_projection projection
  JOIN "InventoryRelationship" relationship ON relationship.id = projection.id
  WHERE NOT projection.self_loop_after_merge
    AND relationship."mergedIntoId" IS NULL
    AND relationship.status <> 'superseded'
)
SELECT id, survivor_id
FROM ranked
WHERE copies > 1
  AND id <> survivor_id;

CREATE TEMP TABLE _dpf_relationship_members (
  relationship_id TEXT PRIMARY KEY,
  survivor_id TEXT NOT NULL
) ON COMMIT DROP;

INSERT INTO _dpf_relationship_members (relationship_id, survivor_id)
SELECT loser_id, survivor_id FROM _dpf_relationship_merge_map
UNION
SELECT survivor_id, survivor_id FROM _dpf_relationship_merge_map;

CREATE TEMP TABLE _dpf_relationship_rollup ON COMMIT DROP AS
SELECT
  members.survivor_id,
  min(relationship."firstSeenAt") AS first_seen_at,
  max(relationship."lastSeenAt") AS last_seen_at,
  (array_agg(relationship."lastConfirmedRunId"
    ORDER BY relationship."lastSeenAt" DESC, relationship.id DESC)
    FILTER (WHERE relationship."lastConfirmedRunId" IS NOT NULL))[1]
      AS last_confirmed_run_id,
  (array_agg(relationship.status
    ORDER BY relationship."lastSeenAt" DESC, relationship.id DESC))[1]
      AS current_status,
  (array_agg(relationship.confidence
    ORDER BY relationship."lastSeenAt" DESC, relationship.id DESC)
    FILTER (WHERE relationship.confidence IS NOT NULL))[1] AS confidence,
  coalesce((
    SELECT jsonb_object_agg(
      property.key,
      property.value
      ORDER BY observed."lastSeenAt", observed.id
    )
    FROM _dpf_relationship_members nested_members
    JOIN "InventoryRelationship" observed
      ON observed.id = nested_members.relationship_id
    CROSS JOIN LATERAL jsonb_each(coalesce(observed.properties, '{}'::jsonb)) property
    WHERE nested_members.survivor_id = members.survivor_id
  ), '{}'::jsonb) AS merged_properties
FROM _dpf_relationship_members members
JOIN "InventoryRelationship" relationship
  ON relationship.id = members.relationship_id
GROUP BY members.survivor_id;

UPDATE "InventoryRelationship" survivor
SET
  status = rollup.current_status,
  confidence = coalesce(rollup.confidence, survivor.confidence),
  properties = rollup.merged_properties,
  "firstSeenAt" = rollup.first_seen_at,
  "lastSeenAt" = rollup.last_seen_at,
  "lastConfirmedRunId" =
    coalesce(rollup.last_confirmed_run_id, survivor."lastConfirmedRunId")
FROM _dpf_relationship_rollup rollup
WHERE survivor.id = rollup.survivor_id;

-- Repoint all relationship-owned evidence before retiring collision losers.
UPDATE "DiscoveredRelationship" child
SET "inventoryRelationshipId" = map.survivor_id
FROM _dpf_relationship_merge_map map
WHERE child."inventoryRelationshipId" = map.loser_id;

UPDATE "PortfolioQualityIssue" child
SET "inventoryRelationshipId" = map.survivor_id
FROM _dpf_relationship_merge_map map
WHERE child."inventoryRelationshipId" = map.loser_id;

UPDATE "InventoryRelationship" existing
SET "mergedIntoId" = map.survivor_id
FROM _dpf_relationship_merge_map map
WHERE existing."mergedIntoId" = map.loser_id;

UPDATE "InventoryRelationship" loser
SET
  status = 'superseded',
  "mergedIntoId" = map.survivor_id,
  properties = coalesce(loser.properties, '{}'::jsonb) || jsonb_build_object(
    '_dpfIntegrityRepair',
    jsonb_build_object(
      'backlogItemId', 'BI-CF4ADDAC',
      'reason', 'projected_tuple_collision',
      'survivorId', map.survivor_id,
      'version', 1
    )
  )
FROM _dpf_relationship_merge_map map
WHERE loser.id = map.loser_id;

UPDATE "InventoryRelationship" relationship
SET
  status = 'superseded',
  "mergedIntoId" = NULL,
  properties = coalesce(relationship.properties, '{}'::jsonb) || jsonb_build_object(
    '_dpfIntegrityRepair',
    jsonb_build_object(
      'backlogItemId', 'BI-CF4ADDAC',
      'reason', 'self_loop_after_entity_merge',
      'version', 1
    )
  )
FROM _dpf_relationship_projection projection
WHERE relationship.id = projection.id
  AND projection.self_loop_after_merge
  AND relationship."mergedIntoId" IS NULL
  AND relationship.status <> 'superseded';

-- Only canonical/surviving relationships move to canonical entity endpoints.
UPDATE "InventoryRelationship" relationship
SET
  "fromEntityId" = projection.future_from_id,
  "toEntityId" = projection.future_to_id
FROM _dpf_relationship_projection projection
WHERE relationship.id = projection.id
  AND NOT projection.self_loop_after_merge
  AND relationship."mergedIntoId" IS NULL
  AND relationship.status <> 'superseded'
  AND NOT EXISTS (
    SELECT 1
    FROM _dpf_relationship_merge_map map
    WHERE map.loser_id = relationship.id
  );

-- Repoint every hard entity reference and the declared RemoteAction soft ref.
UPDATE "ChangeItem" child
SET "inventoryEntityId" = map.survivor_id
FROM _dpf_entity_merge_map map
WHERE child."inventoryEntityId" = map.loser_id;

UPDATE "DiscoveredItem" child
SET "inventoryEntityId" = map.survivor_id
FROM _dpf_entity_merge_map map
WHERE child."inventoryEntityId" = map.loser_id;

UPDATE "DiscoveredSoftwareEvidence" child
SET "inventoryEntityId" = map.survivor_id
FROM _dpf_entity_merge_map map
WHERE child."inventoryEntityId" = map.loser_id;

UPDATE "DiscoveryConnection" child
SET "gatewayEntityId" = map.survivor_id
FROM _dpf_entity_merge_map map
WHERE child."gatewayEntityId" = map.loser_id;

UPDATE "DiscoveryFingerprintObservation" child
SET "inventoryEntityId" = map.survivor_id
FROM _dpf_entity_merge_map map
WHERE child."inventoryEntityId" = map.loser_id;

UPDATE "DiscoveryTriageDecision" child
SET "inventoryEntityId" = map.survivor_id
FROM _dpf_entity_merge_map map
WHERE child."inventoryEntityId" = map.loser_id;

UPDATE "IdentityResolutionLog" child
SET "inventoryEntityId" = map.survivor_id
FROM _dpf_entity_merge_map map
WHERE child."inventoryEntityId" = map.loser_id;

UPDATE "PortfolioQualityIssue" child
SET "inventoryEntityId" = map.survivor_id
FROM _dpf_entity_merge_map map
WHERE child."inventoryEntityId" = map.loser_id;

UPDATE "RemoteAction" child
SET "inventoryEntityId" = map.survivor_id
FROM _dpf_entity_merge_map map
WHERE child."inventoryEntityId" = map.loser_id;

UPDATE "InventoryEntity" existing
SET "mergedIntoId" = map.survivor_id
FROM _dpf_entity_merge_map map
WHERE existing."mergedIntoId" = map.loser_id;

UPDATE "InventoryEntity" loser
SET
  "entityKey" = map.quarantine_key,
  status = 'superseded',
  "mergedIntoId" = map.survivor_id,
  properties = loser.properties || jsonb_build_object(
    '_dpfIntegrityRepair',
    jsonb_build_object(
      'backlogItemId', 'BI-CF4ADDAC',
      'canonicalId', map.survivor_id,
      'originalEntityKey', map.original_key,
      'version', 1
    )
  )
FROM _dpf_entity_merge_map map
WHERE loser.id = map.loser_id;

DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM "InventoryEntity"
    GROUP BY "entityKey"
    HAVING count(*) > 1
  ) THEN
    RAISE EXCEPTION 'InventoryEntity integrity repair left duplicate entityKey values';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM "InventoryRelationship" relationship
    JOIN "InventoryEntity" from_entity ON from_entity.id = relationship."fromEntityId"
    JOIN "InventoryEntity" to_entity ON to_entity.id = relationship."toEntityId"
    WHERE relationship."mergedIntoId" IS NULL
      AND relationship.status <> 'superseded'
      AND (
        from_entity."mergedIntoId" IS NOT NULL
        OR to_entity."mergedIntoId" IS NOT NULL
      )
  ) THEN
    RAISE EXCEPTION 'InventoryRelationship integrity repair left a canonical row on a tombstone endpoint';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM "InventoryRelationship"
    WHERE "mergedIntoId" IS NULL
      AND status <> 'superseded'
    GROUP BY "fromEntityId", "toEntityId", "relationshipType"
    HAVING count(*) > 1
  ) THEN
    RAISE EXCEPTION 'InventoryRelationship integrity repair left duplicate canonical tuples';
  END IF;
END $$;

CREATE UNIQUE INDEX "InventoryEntity_entityKey_key"
  ON "InventoryEntity" ("entityKey");

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'InventoryEntity_mergedIntoId_fkey'
      AND conrelid = '"InventoryEntity"'::regclass
  ) THEN
    ALTER TABLE "InventoryEntity"
      ADD CONSTRAINT "InventoryEntity_mergedIntoId_fkey"
      FOREIGN KEY ("mergedIntoId")
      REFERENCES "InventoryEntity"(id)
      ON DELETE SET NULL
      ON UPDATE CASCADE;
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'InventoryRelationship_mergedIntoId_fkey'
      AND conrelid = '"InventoryRelationship"'::regclass
  ) THEN
    ALTER TABLE "InventoryRelationship"
      ADD CONSTRAINT "InventoryRelationship_mergedIntoId_fkey"
      FOREIGN KEY ("mergedIntoId")
      REFERENCES "InventoryRelationship"(id)
      ON DELETE SET NULL
      ON UPDATE CASCADE;
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS "InventoryEntity_mergedIntoId_idx"
  ON "InventoryEntity" ("mergedIntoId");
CREATE INDEX IF NOT EXISTS "InventoryRelationship_mergedIntoId_idx"
  ON "InventoryRelationship" ("mergedIntoId");

-- The earlier fleet repair rebuilt the remaining indexes, but repeat these
-- two small tables while their writers are locked so this migration closes
-- with one measured heap/index truth.
REINDEX TABLE "InventoryEntity";
REINDEX TABLE "InventoryRelationship";

DO $$
BEGIN
  PERFORM public.bt_index_parent_check(
    format('%I.%I', current_schema(), 'InventoryEntity_entityKey_key')::regclass,
    true,
    true
  );

  IF NOT EXISTS (
    SELECT 1
    FROM pg_index index_state
    JOIN pg_class index_class ON index_class.oid = index_state.indexrelid
    JOIN pg_namespace namespace ON namespace.oid = index_class.relnamespace
    WHERE namespace.nspname = current_schema()
      AND index_class.relname = 'InventoryEntity_entityKey_key'
      AND index_state.indisunique
      AND index_state.indisvalid
      AND index_state.indisready
      AND index_state.indislive
  ) THEN
    RAISE EXCEPTION 'InventoryEntity_entityKey_key is not unique, valid, ready, and live';
  END IF;
END $$;

COMMIT;
