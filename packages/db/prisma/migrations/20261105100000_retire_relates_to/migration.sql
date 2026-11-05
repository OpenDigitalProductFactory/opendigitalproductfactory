-- BI-28C22BE3 (EP-5F6369AB): a Prisma relation is one HAS_FOREIGN_KEY_TO edge per
-- foreign key, written from the model that holds it. The code graph no longer
-- writes RELATES_TO, so the type is retired and its derived edges dropped; the
-- code-graph reconcile (projection version 4) rewrites them typed.
UPDATE "graph_relation_type" SET "status" = 'retired' WHERE "key" = 'RELATES_TO';

DELETE FROM "graph_edge" WHERE "rel_type" = 'RELATES_TO';
