-- Complete the BET-5 Neo4j/Qdrant retirement in the DigitalProduct read model.
--
-- The runtime services were removed in PR #2967, but the curated products and
-- an older auto-discovered Qdrant product remained lifecycleStatus='active'.
-- Preserve the rows and their history; only correct lifecycle state and remove
-- dependency edges that would keep active products pointing at retired stores.
-- @migration-safety: data-safe: bounded updates preserve every product row;
-- the deleted graph edges only target dependencies on explicitly retired IDs.
UPDATE "DigitalProduct"
SET
  "lifecycleStage" = 'retired',
  "lifecycleStatus" = 'retired',
  "updatedAt" = CURRENT_TIMESTAMP
WHERE "productId" IN (
  'infra-neo4j-core',
  'infra-qdrant',
  'infra-qdrant-vector'
)
AND (
  "lifecycleStage" IS DISTINCT FROM 'retired'
  OR "lifecycleStatus" IS DISTINCT FROM 'retired'
);

DELETE FROM "ProductDependency" dependency
USING "DigitalProduct" retired_product
WHERE dependency."toProductId" = retired_product.id
  AND retired_product."productId" IN (
    'infra-neo4j-core',
    'infra-qdrant',
    'infra-qdrant-vector'
  );
