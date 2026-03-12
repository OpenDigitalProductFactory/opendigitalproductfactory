// packages/db/src/neo4j-sync.ts
// Projection sync: push Prisma records into Neo4j after writes.
// These are fire-and-forget projections — failures are logged but never
// allowed to bubble up to the caller. Postgres is always the authority.

import { runCypher } from "./neo4j";

/** Upsert a DigitalProduct node and wire its Portfolio + TaxonomyNode edges. */
export async function syncDigitalProduct(dp: {
  productId: string;
  name: string;
  lifecycleStage: string;
  lifecycleStatus: string;
  portfolioSlug?: string | null;
  taxonomyNodeId?: string | null;
}): Promise<void> {
  // Upsert the node
  await runCypher(
    `MERGE (dp:DigitalProduct {productId: $productId})
     SET dp.name           = $name,
         dp.lifecycleStage = $lifecycleStage,
         dp.lifecycleStatus= $lifecycleStatus,
         dp.syncedAt       = datetime()`,
    dp,
  );

  // BELONGS_TO Portfolio
  if (dp.portfolioSlug) {
    await runCypher(
      `MATCH (dp:DigitalProduct {productId: $productId})
       MERGE (p:Portfolio {slug: $slug})
       MERGE (dp)-[:BELONGS_TO]->(p)`,
      { productId: dp.productId, slug: dp.portfolioSlug },
    );
  }

  // CATEGORIZED_AS TaxonomyNode (nodeId stored on the Prisma TaxonomyNode)
  if (dp.taxonomyNodeId) {
    await runCypher(
      `MATCH (dp:DigitalProduct {productId: $productId})
       MERGE (tn:TaxonomyNode {pgId: $taxonomyNodeId})
       MERGE (dp)-[:CATEGORIZED_AS]->(tn)`,
      { productId: dp.productId, taxonomyNodeId: dp.taxonomyNodeId },
    );
  }
}

/** Upsert a TaxonomyNode node and its CHILD_OF parent edge. */
export async function syncTaxonomyNode(tn: {
  nodeId: string;
  name: string;
  pgId: string;
  parentNodeId?: string | null;
}): Promise<void> {
  await runCypher(
    `MERGE (n:TaxonomyNode {nodeId: $nodeId})
     SET n.name    = $name,
         n.pgId    = $pgId,
         n.syncedAt= datetime()`,
    tn,
  );

  if (tn.parentNodeId) {
    await runCypher(
      `MATCH (child:TaxonomyNode  {nodeId: $nodeId})
       MERGE (parent:TaxonomyNode {nodeId: $parentNodeId})
       MERGE (child)-[:CHILD_OF]->(parent)`,
      { nodeId: tn.nodeId, parentNodeId: tn.parentNodeId },
    );
  }
}

/** Upsert a Portfolio node. */
export async function syncPortfolio(p: {
  slug: string;
  name: string;
}): Promise<void> {
  await runCypher(
    `MERGE (p:Portfolio {slug: $slug})
     SET p.name     = $name,
         p.syncedAt = datetime()`,
    p,
  );
}

/** Upsert an InfraCI node. */
export async function syncInfraCI(ci: {
  ciId: string;
  name: string;
  ciType: string;   // server | container | database | service | network
  status: string;   // operational | degraded | offline
  portfolioSlug?: string | null;
}): Promise<void> {
  await runCypher(
    `MERGE (ci:InfraCI {ciId: $ciId})
     SET ci.name        = $name,
         ci.ciType      = $ciType,
         ci.status      = $status,
         ci.syncedAt    = datetime()`,
    ci,
  );

  if (ci.portfolioSlug) {
    await runCypher(
      `MATCH (ci:InfraCI {ciId: $ciId})
       MERGE (p:Portfolio {slug: $portfolioSlug})
       MERGE (ci)-[:BELONGS_TO]->(p)`,
      { ciId: ci.ciId, portfolioSlug: ci.portfolioSlug },
    );
  }
}

/** Create or replace a DEPENDS_ON relationship between two nodes.
 *  fromLabel / toLabel: "DigitalProduct" | "InfraCI"
 *  fromId / toId: the unique key value (productId or ciId respectively)
 */
export async function syncDependsOn(dep: {
  fromLabel: "DigitalProduct" | "InfraCI";
  fromId: string;
  toLabel: "InfraCI";
  toId: string;
  role?: string;   // e.g. "database" | "runtime" | "network"
  since?: string;  // ISO date string
}): Promise<void> {
  const fromKey = dep.fromLabel === "DigitalProduct" ? "productId" : "ciId";
  await runCypher(
    `MATCH (from:${dep.fromLabel} {${fromKey}: $fromId})
     MATCH (to:InfraCI           {ciId: $toId})
     MERGE (from)-[r:DEPENDS_ON]->(to)
     SET r.role     = $role,
         r.since    = $since,
         r.syncedAt = datetime()`,
    { fromId: dep.fromId, toId: dep.toId, role: dep.role ?? null, since: dep.since ?? null },
  );
}
