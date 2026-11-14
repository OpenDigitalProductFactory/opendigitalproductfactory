-- BI-92804832 (EP-5F6369AB): the drift repair's EA step, in its own migration because
-- 20261105130000_relation_drift_repair is already committed.

-- EA: an association needs a role naming what it means (BI-E487F6D9). A role-less
--    association from an element to itself names nothing and has no typed reading to retype
--    to, so it is retired together with its graph projection. Associations between two
--    different elements are left for their owners to qualify.
WITH retired AS (
  DELETE FROM "EaRelationship" r
   USING "EaRelationshipType" t
   WHERE t.id = r."relationshipTypeId" AND t.slug = 'associated_with'
     AND r."fromElementId" = r."toElementId"
     AND coalesce(btrim(r."properties"->>'role'), '') = ''
  RETURNING r.id
)
DELETE FROM "graph_edge" e
 USING retired
 WHERE e.rel_type = 'ASSOCIATED_WITH' AND e.props->>'relationshipId' = retired.id;
