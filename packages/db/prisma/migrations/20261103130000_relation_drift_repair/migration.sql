-- BI-92804832 (EP-5F6369AB): one spelling and one meaning per relation in every store.

-- 1. Registry: owl:sameAs, schema.org citation, dcterms:replaces.
INSERT INTO "graph_relation_type" ("key", "relation_class", "label", "inverse_label", "status") VALUES
  ('SAME_AS', 'semantic', 'is the same as', 'is the same as', 'active'),
  ('CITES', 'provenance', 'cites', 'is cited by', 'active'),
  ('SUPERSEDES', 'provenance', 'supersedes', 'is superseded by', 'active')
ON CONFLICT ("key") DO NOTHING;

-- 2. The OS host and the Docker host records are one machine (rule host_is_docker_host):
--    SAME_AS, not a workload RUNS_ON a platform. Keys keep the collector's spelling.
UPDATE "InventoryRelationship" SET "relationshipType" = 'SAME_AS'
 WHERE "relationshipType" = 'RUNS_ON' AND "properties"->>'rule' = 'host_is_docker_host';
UPDATE "DiscoveredRelationship" d SET "relationshipType" = 'SAME_AS'
  FROM "InventoryRelationship" r
 WHERE d."inventoryRelationshipId" = r.id AND r."relationshipType" = 'SAME_AS' AND d."relationshipType" = 'RUNS_ON';

-- 3. One spelling: the collectors wrote "hosts"/"monitors" beside "HOSTS"/"MONITORS".
UPDATE "InventoryRelationship" r SET "relationshipType" = upper(r."relationshipType")
 WHERE r."relationshipType" IN ('hosts', 'monitors', 'runs_on', 'member_of', 'connects_to', 'routes_through', 'uplinks_to')
   AND NOT EXISTS (
     SELECT 1 FROM "InventoryRelationship" o
      WHERE o."fromEntityId" = r."fromEntityId" AND o."toEntityId" = r."toEntityId"
        AND o."relationshipType" = upper(r."relationshipType"));
UPDATE "DiscoveredRelationship" SET "relationshipType" = upper("relationshipType")
 WHERE "relationshipType" IN ('hosts', 'monitors', 'runs_on', 'member_of', 'connects_to', 'routes_through', 'uplinks_to');

-- 4. Graph: retype the same-machine edges.
INSERT INTO "graph_edge" ("src_key", "dst_key", "rel_type", "props")
SELECT e.src_key, e.dst_key, 'SAME_AS', e.props
  FROM "graph_edge" e
  JOIN "InventoryEntity" f ON f."entityKey" = e.src_key
  JOIN "InventoryEntity" t ON t."entityKey" = e.dst_key
  JOIN "InventoryRelationship" r ON r."fromEntityId" = f.id AND r."toEntityId" = t.id AND r."relationshipType" = 'SAME_AS'
 WHERE e.rel_type = 'RUNS_ON'
ON CONFLICT ("src_key", "dst_key", "rel_type") DO NOTHING;
DELETE FROM "graph_edge" e
 USING "InventoryEntity" f, "InventoryEntity" t, "InventoryRelationship" r
 WHERE e.rel_type = 'RUNS_ON'
   AND f."entityKey" = e.src_key AND t."entityKey" = e.dst_key
   AND r."fromEntityId" = f.id AND r."toEntityId" = t.id AND r."relationshipType" = 'SAME_AS';

-- 5. Graph: product-to-product dependencies, which were never projected.
INSERT INTO "graph_edge" ("src_key", "dst_key", "rel_type", "props")
SELECT f."productId", t."productId",
       CASE d."relationType" WHEN 'part_of' THEN 'PART_OF' ELSE 'DEPENDS_ON' END,
       jsonb_build_object('source', 'ProductDependency')
  FROM "ProductDependency" d
  JOIN "DigitalProduct" f ON f.id = d."fromProductId"
  JOIN "DigitalProduct" t ON t.id = d."toProductId"
 WHERE d."relationType" IN ('depends_on', 'part_of')
ON CONFLICT ("src_key", "dst_key", "rel_type") DO NOTHING;

-- 6. Graph: document references by their PROV-O / schema.org meaning (documentReferenceRelation).
INSERT INTO "graph_edge" ("src_key", "dst_key", "rel_type", "props")
SELECT e.src_key, e.dst_key,
       CASE lower(e.props->>'refType')
         WHEN 'canonical-source' THEN 'HAD_PRIMARY_SOURCE'
         WHEN 'source-artifact' THEN 'WAS_DERIVED_FROM'
         WHEN 'derived-from' THEN 'WAS_DERIVED_FROM'
         WHEN 'source' THEN 'WAS_DERIVED_FROM'
         WHEN 'provided-rendered-input' THEN 'USED'
         WHEN 'capture-context' THEN 'WAS_INFORMED_BY'
         WHEN 'cites' THEN 'CITES'
         WHEN 'supersedes' THEN 'SUPERSEDES'
         WHEN 'contains' THEN 'CONTAINS'
       END,
       e.props
  FROM "graph_edge" e
 WHERE e.rel_type = 'DOC_REFERENCES'
   AND lower(e.props->>'refType') IN ('canonical-source', 'source-artifact', 'derived-from', 'source',
     'provided-rendered-input', 'capture-context', 'cites', 'supersedes', 'contains')
ON CONFLICT ("src_key", "dst_key", "rel_type") DO NOTHING;
DELETE FROM "graph_edge"
 WHERE rel_type = 'DOC_REFERENCES'
   AND lower(props->>'refType') IN ('canonical-source', 'source-artifact', 'derived-from', 'source',
     'provided-rendered-input', 'capture-context', 'cites', 'supersedes', 'contains');
