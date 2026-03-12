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

// ─── EA Modeling sync ─────────────────────────────────────────────────────────

/** Upsert an EaElement node with dual labels (:EaElement:NeoLabel).
 *  Also creates EA_REPRESENTS edges to any bridge entities that are set. */
export async function syncEaElement(element: {
  id: string;
  neoLabel: string;         // from EaElementType.neoLabel
  notationSlug: string;     // from EaElementType.notation.slug
  elementTypeSlug: string;  // from EaElementType.slug
  name: string;
  lifecycleStage: string;
  lifecycleStatus: string;
  digitalProductId?: string | null;
  portfolioId?: string | null;
  taxonomyNodeId?: string | null;
}): Promise<void> {
  // Upsert the node — Cypher MERGE requires exact label set; we use apoc.merge.node
  // for the dual-label pattern. Fall back to a parameterised label approach.
  await runCypher(
    `MERGE (n:EaElement {elementId: $id})
     SET n.notationId      = $notationSlug,
         n.elementType     = $elementTypeSlug,
         n.name            = $name,
         n.lifecycleStage  = $lifecycleStage,
         n.lifecycleStatus = $lifecycleStatus,
         n.syncedAt        = datetime()`,
    {
      id: element.id,
      notationSlug: element.notationSlug,
      elementTypeSlug: element.elementTypeSlug,
      name: element.name,
      lifecycleStage: element.lifecycleStage,
      lifecycleStatus: element.lifecycleStatus,
    },
  );

  // Add the type-specific label via APOC (safe if APOC not available — node still functions with :EaElement)
  await runCypher(
    `MATCH (n:EaElement {elementId: $id})
     CALL apoc.create.addLabels(n, [$neoLabel]) YIELD node
     RETURN node`,
    { id: element.id, neoLabel: element.neoLabel },
  ).catch(() => {
    // Any error (e.g. APOC not installed) — type-specific label skipped; :EaElement label still present
  });

  // EA_REPRESENTS → DigitalProduct
  if (element.digitalProductId) {
    await runCypher(
      `MATCH (ea:EaElement {elementId: $id})
       MATCH (dp:DigitalProduct {productId: $digitalProductId})
       MERGE (ea)-[:EA_REPRESENTS]->(dp)`,
      { id: element.id, digitalProductId: element.digitalProductId },
    );
  }

  // EA_REPRESENTS → Portfolio
  if (element.portfolioId) {
    await runCypher(
      `MATCH (ea:EaElement {elementId: $id})
       MATCH (p:Portfolio {id: $portfolioId})
       MERGE (ea)-[:EA_REPRESENTS]->(p)`,
      { id: element.id, portfolioId: element.portfolioId },
    );
  }

  // EA_REPRESENTS → TaxonomyNode
  if (element.taxonomyNodeId) {
    await runCypher(
      `MATCH (ea:EaElement {elementId: $id})
       MATCH (tn:TaxonomyNode {pgId: $taxonomyNodeId})
       MERGE (ea)-[:EA_REPRESENTS]->(tn)`,
      { id: element.id, taxonomyNodeId: element.taxonomyNodeId },
    );
  }
}

/** Upsert an EaRelationship edge between two EaElement nodes. */
export async function syncEaRelationship(rel: {
  id: string;
  fromElementId: string;
  toElementId: string;
  neoType: string;      // from EaRelationshipType.neoType
  notationSlug: string;
  relationshipTypeSlug: string;
}): Promise<void> {
  await runCypher(
    `MATCH (from:EaElement {elementId: $fromId})
     MATCH (to:EaElement   {elementId: $toId})
     MERGE (from)-[r:${rel.neoType} {relationshipId: $id}]->(to)
     SET r.notationId       = $notationSlug,
         r.relationshipType = $relationshipTypeSlug,
         r.syncedAt         = datetime()`,
    {
      id: rel.id,
      fromId: rel.fromElementId,
      toId: rel.toElementId,
      notationSlug: rel.notationSlug,
      relationshipTypeSlug: rel.relationshipTypeSlug,
    },
  );
}

/** Remove an EaElement node and all its EA edges. */
export async function deleteEaElement(elementId: string): Promise<void> {
  await runCypher(
    `MATCH (n:EaElement {elementId: $elementId})
     DETACH DELETE n`,
    { elementId },
  );
}

/** Remove a single EaRelationship edge by its relationshipId property. */
export async function deleteEaRelationship(relationshipId: string): Promise<void> {
  await runCypher(
    `MATCH ()-[r {relationshipId: $relationshipId}]->()
     DELETE r`,
    { relationshipId },
  );
}
