// packages/db/src/neo4j-graph.ts
// Cypher traversal helpers for impact analysis and graph queries.
// All functions return plain objects — no neo4j-driver types leak out.
// Postgres/Prisma is the authority; these are read-only projections.

import { runCypher } from "./neo4j";

// ─── Types ────────────────────────────────────────────────────────────────────

export type GraphNode = {
  id: string;       // the unique key (productId, ciId, nodeId, slug)
  label: string;    // "DigitalProduct" | "TaxonomyNode" | "Portfolio" | "InfraCI"
  name: string;
  properties: Record<string, unknown>;
};

export type GraphEdge = {
  from: string;
  to: string;
  type: string;     // "DEPENDS_ON" | "BELONGS_TO" | etc.
  properties: Record<string, unknown>;
};

export type ImpactResult = {
  node: GraphNode;
  depth: number;
  path: string[];   // sequence of node IDs from origin to this node
};

// ─── Impact analysis ─────────────────────────────────────────────────────────

/**
 * Downstream impact: everything that depends (directly or transitively) on
 * the given InfraCI. Returns affected nodes ordered by depth.
 * Used for "if this CI goes down, what breaks?"
 */
export async function getDownstreamImpact(ciId: string, maxDepth = 10): Promise<ImpactResult[]> {
  const rows = await runCypher<{
    affected: { identity: unknown; labels: string[]; properties: Record<string, unknown> };
    depth: unknown;
    path: unknown[];
  }>(
    `MATCH p = (origin:InfraCI {ciId: $ciId})<-[:DEPENDS_ON*1..${maxDepth}]-(affected)
     RETURN affected, length(p) AS depth,
            [n IN nodes(p) | coalesce(n.productId, n.ciId, n.nodeId, n.slug)] AS path
     ORDER BY depth`,
    { ciId },
  );

  return rows.map((r) => ({
    node: nodeFromRecord(r.affected),
    depth: Number(r.depth),
    path: r.path as string[],
  }));
}

/**
 * Upstream dependencies: everything the given node (product or CI) depends on,
 * transitively. Used for "what does this depend on?"
 */
export async function getUpstreamDependencies(
  nodeKey: string,
  keyField: "productId" | "ciId",
  maxDepth = 10,
): Promise<ImpactResult[]> {
  const label = keyField === "productId" ? "DigitalProduct" : "InfraCI";
  const rows = await runCypher<{
    dep: { identity: unknown; labels: string[]; properties: Record<string, unknown> };
    depth: unknown;
    path: unknown[];
  }>(
    `MATCH p = (origin:${label} {${keyField}: $nodeKey})-[:DEPENDS_ON*1..${maxDepth}]->(dep)
     RETURN dep, length(p) AS depth,
            [n IN nodes(p) | coalesce(n.productId, n.ciId, n.nodeId, n.slug)] AS path
     ORDER BY depth`,
    { nodeKey },
  );

  return rows.map((r) => ({
    node: nodeFromRecord(r.dep),
    depth: Number(r.depth),
    path: r.path as string[],
  }));
}

// ─── Portfolio / taxonomy traversal ──────────────────────────────────────────

/**
 * All DigitalProducts in a portfolio (direct BELONGS_TO).
 */
export async function getProductsByPortfolio(slug: string): Promise<GraphNode[]> {
  const rows = await runCypher<{
    dp: { identity: unknown; labels: string[]; properties: Record<string, unknown> };
  }>(
    `MATCH (dp:DigitalProduct)-[:BELONGS_TO]->(p:Portfolio {slug: $slug})
     RETURN dp ORDER BY dp.name`,
    { slug },
  );
  return rows.map((r) => nodeFromRecord(r.dp));
}

/**
 * All DigitalProducts categorised under a TaxonomyNode or any of its
 * descendants (subtree). Uses CHILD_OF edges traversed in reverse.
 */
export async function getProductsByTaxonomySubtree(nodeId: string): Promise<GraphNode[]> {
  const rows = await runCypher<{
    dp: { identity: unknown; labels: string[]; properties: Record<string, unknown> };
  }>(
    `MATCH (root:TaxonomyNode {nodeId: $nodeId})
     MATCH (tn:TaxonomyNode)
     WHERE tn = root OR (tn)-[:CHILD_OF*1..20]->(root)
     MATCH (dp:DigitalProduct)-[:CATEGORIZED_AS]->(tn)
     RETURN DISTINCT dp ORDER BY dp.name`,
    { nodeId },
  );
  return rows.map((r) => nodeFromRecord(r.dp));
}

/**
 * Shortest dependency path between two nodes (any label).
 * Returns the sequence of node IDs along the path, or [] if unreachable.
 */
export async function shortestPath(fromKey: string, toKey: string): Promise<string[]> {
  const rows = await runCypher<{ path: unknown[] }>(
    `MATCH (a), (b)
     WHERE coalesce(a.productId, a.ciId, a.nodeId, a.slug) = $fromKey
       AND coalesce(b.productId, b.ciId, b.nodeId, b.slug) = $toKey
     MATCH p = shortestPath((a)-[:DEPENDS_ON*]-(b))
     RETURN [n IN nodes(p) | coalesce(n.productId, n.ciId, n.nodeId, n.slug)] AS path`,
    { fromKey, toKey },
  );
  return rows[0]?.path as string[] ?? [];
}

// ─── InfraCI helpers ─────────────────────────────────────────────────────────

/**
 * All InfraCI nodes with their status, optionally filtered by ciType.
 */
export async function getInfraCIs(ciType?: string): Promise<GraphNode[]> {
  const where = ciType ? "WHERE ci.ciType = $ciType" : "";
  const rows = await runCypher<{
    ci: { identity: unknown; labels: string[]; properties: Record<string, unknown> };
  }>(
    `MATCH (ci:InfraCI) ${where} RETURN ci ORDER BY ci.name`,
    ciType ? { ciType } : {},
  );
  return rows.map((r) => nodeFromRecord(r.ci));
}

/**
 * Direct neighbours of a node — one hop in any relationship direction.
 * Useful for the CI detail view sidebar.
 */
export async function getNeighbours(nodeKey: string): Promise<{
  incoming: Array<{ node: GraphNode; relType: string }>;
  outgoing: Array<{ node: GraphNode; relType: string }>;
}> {
  const [inRows, outRows] = await Promise.all([
    runCypher<{
      n: { identity: unknown; labels: string[]; properties: Record<string, unknown> };
      type: string;
    }>(
      `MATCH (target)-[r]->(me)
       WHERE coalesce(me.productId, me.ciId, me.nodeId, me.slug) = $key
       RETURN target AS n, type(r) AS type`,
      { key: nodeKey },
    ),
    runCypher<{
      n: { identity: unknown; labels: string[]; properties: Record<string, unknown> };
      type: string;
    }>(
      `MATCH (me)-[r]->(target)
       WHERE coalesce(me.productId, me.ciId, me.nodeId, me.slug) = $key
       RETURN target AS n, type(r) AS type`,
      { key: nodeKey },
    ),
  ]);

  return {
    incoming: inRows.map((r)  => ({ node: nodeFromRecord(r.n),  relType: r.type })),
    outgoing: outRows.map((r) => ({ node: nodeFromRecord(r.n),  relType: r.type })),
  };
}

// ─── Internal helper ──────────────────────────────────────────────────────────

function nodeFromRecord(raw: {
  identity: unknown;
  labels: string[];
  properties: Record<string, unknown>;
}): GraphNode {
  const props = raw.properties;
  const label = raw.labels[0] ?? "Unknown";
  const id =
    (props["productId"] as string | undefined) ??
    (props["ciId"]      as string | undefined) ??
    (props["nodeId"]    as string | undefined) ??
    (props["slug"]      as string | undefined) ??
    String(raw.identity);

  return {
    id,
    label,
    name: (props["name"] as string | undefined) ?? id,
    properties: props,
  };
}
