// BET-5 (BI-A1E864A5): Postgres graph traversal, a drop-in replacement for neo4j-graph.ts.
// Reimplements the same exported surface (GraphNode, GraphEdge, ImpactResult, PruneResult,
// LayeredDependency, Neo4jTopologyScope, getDownstreamImpact, getUpstreamDependencies,
// getProductsByPortfolio, getProductsByTaxonomySubtree, shortestPath, pruneStaleInfraCIDatabaseRecords,
// getLayeredDependencyStack, getNetworkTopologyAtLayer, getNetworkTopologyAtLayerForScope,
// getInfraCIs, getNeighbours) over the `graph_node` / `graph_edge` tables (see the
// 20260714120000_bet5_graph_mirror migration) so Neo4j can be retired with an import swap.
//
// The Cypher traversals become `WITH RECURSIVE` CTEs. A node's universal key
// = coalesce(productId, ciId, nodeId, slug) — that is `graph_node.key`. `labels`
// is the old Neo4j labels array; `props` carries name/ciId/productId/nodeId/slug/
// decommissionedAt/osiLayer/etc. Edges are directed rows in `graph_edge`.
//
// NOT YET WIRED: callers still import from ./neo4j-graph until the cutover repoints them.

import { prisma } from "./client";

// ─── Traversal constants ─────────────────────────────────────────────────────
// All relationship types that impact analysis and dependency queries should
// traverse. Defined once to avoid drift between queries. Exported so the SQL
// builders (and their unit tests) share one source of truth.

export const IMPACT_RELATIONSHIP_TYPES = [
  "DEPENDS_ON",
  "HOSTS",
  "RUNS_ON",
  "LISTENS_ON",
  "MONITORS",
  "MEMBER_OF",
  "ROUTES_THROUGH",
  "CARRIED_BY",
  "CONNECTS_TO",
  "PEER_OF",
] as const;

/** Cypher relationship filter fragment, e.g. ":DEPENDS_ON|HOSTS|RUNS_ON|..." (parity with neo4j-graph). */
export const IMPACT_REL_FILTER = IMPACT_RELATIONSHIP_TYPES.map((t) => t).join("|");

/** Mutable copy for binding as a Postgres text[] param (`= ANY($1::text[])`). */
function impactRelParam(): string[] {
  return [...IMPACT_RELATIONSHIP_TYPES];
}

// ─── Types (identical to neo4j-graph.ts) ─────────────────────────────────────

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

// ─── Row → GraphNode mapping ─────────────────────────────────────────────────
// Mirrors nodeFromRecord in neo4j-graph.ts: primary label = labels[0] (else
// "Unknown"); id = props coalesce, falling back to the row key (which itself is
// coalesce(productId,ciId,nodeId,slug), so it equals the Neo4j String(identity)
// fallback in practice); name = props.name ?? id.

type NodeRow = { key: string; labels: string[]; props: Record<string, unknown> };

/** Exported for unit testing the label/name/id mapping without a database. */
export function nodeFromRow(row: NodeRow): GraphNode {
  const props = row.props ?? {};
  const label = row.labels?.[0] ?? "Unknown";
  const id =
    (props["productId"] as string | undefined) ??
    (props["ciId"]      as string | undefined) ??
    (props["nodeId"]    as string | undefined) ??
    (props["slug"]      as string | undefined) ??
    row.key;

  return {
    id,
    label,
    name: (props["name"] as string | undefined) ?? id,
    properties: props,
  };
}

// ─── Reachability CTE builder ────────────────────────────────────────────────
// Shared by getDownstreamImpact (reverse: Cypher `origin<-[*]-affected`, walk
// dst→src) and getUpstreamDependencies (forward: `origin-[*]->dep`, walk
// src→dst). Params: $1 = rel-type text[], $2 = origin key. `maxDepth` is the
// only interpolated value and is truncated to a positive integer first.

type WalkDirection = "downstream" | "upstream";

/** Exported for unit testing the SQL shape/depth-cap without a database. */
export function reachabilitySql(
  direction: WalkDirection,
  originLabel: string,
  maxDepth: number,
): string {
  const cap = Math.max(1, Math.trunc(Number(maxDepth)) || 1);
  // downstream: match edges pointing INTO the current node (dst), step to src.
  // upstream:   match edges leaving the current node (src), step to dst.
  const matchCol = direction === "downstream" ? "dst_key" : "src_key";
  const nextCol = direction === "downstream" ? "src_key" : "dst_key";
  const labelLit = `'${originLabel.replace(/'/g, "''")}'`;
  return `
    WITH RECURSIVE walk AS (
      SELECT e.${nextCol} AS node_key, 1 AS depth,
             ARRAY[$2::text, e.${nextCol}] AS path
        FROM graph_edge e
        JOIN graph_node origin
          ON origin.key = $2 AND ${labelLit} = ANY(origin.labels)
       WHERE e.${matchCol} = $2
         AND e.rel_type = ANY($1::text[])
      UNION ALL
      SELECT e.${nextCol}, w.depth + 1, w.path || e.${nextCol}
        FROM walk w
        JOIN graph_edge e ON e.${matchCol} = w.node_key
       WHERE e.rel_type = ANY($1::text[])
         AND w.depth < ${cap}
         AND NOT e.${nextCol} = ANY(w.path)
    )
    SELECT n.key, n.labels, n.props, w.depth, w.path
      FROM walk w
      JOIN graph_node n ON n.key = w.node_key
     ORDER BY w.depth`;
}

type WalkRow = NodeRow & { depth: number | bigint; path: string[] };

// ─── Impact analysis ─────────────────────────────────────────────────────────

/**
 * Downstream impact: everything that depends (directly or transitively) on
 * the given InfraCI. Returns affected nodes ordered by depth.
 * "if this CI goes down, what breaks?" — reverse reachability over IMPACT rels.
 */
export async function getDownstreamImpact(ciId: string, maxDepth = 10): Promise<ImpactResult[]> {
  const rows = (await prisma.$queryRawUnsafe(
    reachabilitySql("downstream", "InfraCI", maxDepth),
    impactRelParam(),
    ciId,
  )) as WalkRow[];

  return rows.map((r) => ({
    node: nodeFromRow(r),
    depth: Number(r.depth),
    path: r.path,
  }));
}

/**
 * Upstream dependencies: everything the given node (product or CI) depends on,
 * transitively. Forward reachability over IMPACT rels.
 */
export async function getUpstreamDependencies(
  nodeKey: string,
  keyField: "productId" | "ciId",
  maxDepth = 10,
): Promise<ImpactResult[]> {
  const label = keyField === "productId" ? "DigitalProduct" : "InfraCI";
  const rows = (await prisma.$queryRawUnsafe(
    reachabilitySql("upstream", label, maxDepth),
    impactRelParam(),
    nodeKey,
  )) as WalkRow[];

  return rows.map((r) => ({
    node: nodeFromRow(r),
    depth: Number(r.depth),
    path: r.path,
  }));
}

// ─── Portfolio / taxonomy traversal ──────────────────────────────────────────

/**
 * All DigitalProducts in a portfolio (direct BELONGS_TO edge to Portfolio{slug}).
 */
export async function getProductsByPortfolio(slug: string): Promise<GraphNode[]> {
  const rows = (await prisma.$queryRawUnsafe(
    `SELECT n.key, n.labels, n.props
       FROM graph_node n
       JOIN graph_edge e
         ON e.src_key = n.key AND e.rel_type = 'BELONGS_TO' AND e.dst_key = $1
      WHERE 'DigitalProduct' = ANY(n.labels)
      ORDER BY n.props->>'name'`,
    slug,
  )) as NodeRow[];
  return rows.map(nodeFromRow);
}

/**
 * All DigitalProducts categorised under a TaxonomyNode or any of its
 * descendants (subtree). CHILD_OF edges (child→parent) traversed in reverse.
 */
export async function getProductsByTaxonomySubtree(nodeId: string): Promise<GraphNode[]> {
  const rows = (await prisma.$queryRawUnsafe(
    `WITH RECURSIVE subtree AS (
       SELECT $1::text AS node_key, 0 AS depth, ARRAY[$1::text] AS path
       UNION ALL
       SELECT e.src_key, s.depth + 1, s.path || e.src_key
         FROM subtree s
         JOIN graph_edge e ON e.dst_key = s.node_key AND e.rel_type = 'CHILD_OF'
        WHERE s.depth < 20 AND NOT e.src_key = ANY(s.path)
     )
     SELECT DISTINCT n.key, n.labels, n.props
       FROM subtree s
       JOIN graph_edge e ON e.dst_key = s.node_key AND e.rel_type = 'CATEGORIZED_AS'
       JOIN graph_node n ON n.key = e.src_key AND 'DigitalProduct' = ANY(n.labels)
      ORDER BY n.props->>'name'`,
    nodeId,
  )) as NodeRow[];
  return rows.map(nodeFromRow);
}

/**
 * Shortest dependency path between two nodes (any label), edges treated as
 * UNDIRECTED over IMPACT rels. Returns node keys along the path, [] if unreachable.
 */
export async function shortestPath(fromKey: string, toKey: string): Promise<string[]> {
  const rows = (await prisma.$queryRawUnsafe(
    `WITH RECURSIVE undirected AS (
       SELECT src_key AS a, dst_key AS b FROM graph_edge WHERE rel_type = ANY($3::text[])
       UNION ALL
       SELECT dst_key AS a, src_key AS b FROM graph_edge WHERE rel_type = ANY($3::text[])
     ),
     bfs AS (
       SELECT $1::text AS node_key, 0 AS depth, ARRAY[$1::text] AS path
       UNION ALL
       SELECT u.b, w.depth + 1, w.path || u.b
         FROM bfs w
         JOIN undirected u ON u.a = w.node_key
        WHERE w.node_key <> $2
          AND w.depth < ${SHORTEST_PATH_MAX_HOPS}
          AND NOT u.b = ANY(w.path)
     )
     SELECT path FROM bfs WHERE node_key = $2 ORDER BY depth LIMIT 1`,
    fromKey,
    toKey,
    impactRelParam(),
  )) as Array<{ path: string[] }>;
  return rows[0]?.path ?? [];
}

// Safety valve so the all-simple-paths BFS terminates on pathological graphs;
// the per-path cycle guard already bounds it, this just caps the worst case.
const SHORTEST_PATH_MAX_HOPS = 50;

// ─── Stale CI pruning ────────────────────────────────────────────────────────

export type PruneResult = {
  marked: number;   // stamped decommissionedAt
  deleted: number;  // hard-deleted (+ their edges)
};

/**
 * Two-phase prune of InfraCI nodes no longer seen by discovery:
 *  Phase 1 — stamp decommissionedAt on stale nodes (status stays as-is)
 *  Phase 2 — hard-delete nodes decommissioned for deleteAfterDays (+ their edges)
 *
 * Uses a separate `decommissionedAt` timestamp rather than mutating `status`.
 * Idempotent; safe to run on a schedule. Does NOT touch recently-synced nodes.
 */
export async function pruneStaleInfraCIDatabaseRecords({
  markDecommissionedAfterDays = 30,
  deleteAfterDays = 90,
}: {
  markDecommissionedAfterDays?: number;
  deleteAfterDays?: number;
} = {}): Promise<PruneResult> {
  const now = Date.now();
  const nowIso          = new Date(now).toISOString();
  const markThreshold   = new Date(now - markDecommissionedAfterDays * 86_400_000).toISOString();
  const deleteThreshold = new Date(now - deleteAfterDays             * 86_400_000).toISOString();

  // Phase 1: stamp decommissionedAt on stale nodes not yet marked.
  // decommissionedAt IS NULL  ⇒ props->>'decommissionedAt' IS NULL (key absent or json null)
  // syncedAt IS NOT NULL AND syncedAt < markThreshold
  const marked = await prisma.$executeRawUnsafe(
    `UPDATE graph_node
        SET props = jsonb_set(props, '{decommissionedAt}', to_jsonb($3::text), true)
      WHERE 'InfraCI' = ANY(labels)
        AND props->>'decommissionedAt' IS NULL
        AND props->>'syncedAt' IS NOT NULL
        AND (props->>'syncedAt')::timestamptz < $1::timestamptz`,
    markThreshold,
    deleteThreshold, // $2 unused by this statement but keeps param order stable
    nowIso,
  );

  // Phase 2: count then hard-delete nodes decommissioned longer than deleteAfterDays.
  const countRows = (await prisma.$queryRawUnsafe(
    `SELECT count(*)::int AS to_delete
       FROM graph_node
      WHERE 'InfraCI' = ANY(labels)
        AND props->>'decommissionedAt' IS NOT NULL
        AND (props->>'decommissionedAt')::timestamptz < $1::timestamptz`,
    deleteThreshold,
  )) as Array<{ to_delete: number | bigint }>;
  const toDelete = Number(countRows[0]?.to_delete ?? 0);

  if (toDelete > 0) {
    // DETACH DELETE equivalent: drop incident edges first, then the nodes.
    const staleFilter =
      `'InfraCI' = ANY(labels)
        AND props->>'decommissionedAt' IS NOT NULL
        AND (props->>'decommissionedAt')::timestamptz < $1::timestamptz`;
    await prisma.$executeRawUnsafe(
      `DELETE FROM graph_edge
        WHERE src_key IN (SELECT key FROM graph_node WHERE ${staleFilter})
           OR dst_key IN (SELECT key FROM graph_node WHERE ${staleFilter})`,
      deleteThreshold,
    );
    await prisma.$executeRawUnsafe(
      `DELETE FROM graph_node WHERE ${staleFilter}`,
      deleteThreshold,
    );
  }

  return { marked: Number(marked), deleted: toDelete };
}

// ─── OSI-aware topology queries ─────────────────────────────────────────────

export type LayeredDependency = {
  osiLayer: number | null;
  osiLayerName: string | null;
  nodes: GraphNode[];
};

/**
 * All dependencies of a product grouped by OSI layer, traversing IMPACT rels
 * up to 15 hops. DISTINCT dep (a node reachable by many paths appears once).
 */
export async function getLayeredDependencyStack(productId: string): Promise<LayeredDependency[]> {
  const rows = (await prisma.$queryRawUnsafe(
    reachabilitySql("upstream", "DigitalProduct", 15),
    impactRelParam(),
    productId,
  )) as WalkRow[];

  // DISTINCT dep — dedupe by key, then group by OSI layer (from props).
  const byLayer = new Map<number | null, { layerName: string | null; nodes: GraphNode[] }>();
  const seen = new Set<string>();
  for (const r of rows) {
    if (seen.has(r.key)) continue;
    seen.add(r.key);
    const props = r.props ?? {};
    const rawLayer = props["osiLayer"];
    const layer = rawLayer != null ? Number(rawLayer) : null;
    const layerName = (props["osiLayerName"] as string | null) ?? null;
    let entry = byLayer.get(layer);
    if (!entry) {
      entry = { layerName, nodes: [] };
      byLayer.set(layer, entry);
    }
    entry.nodes.push(nodeFromRow(r));
  }

  return Array.from(byLayer.entries())
    .sort((a, b) => (a[0] ?? 99) - (b[0] ?? 99))
    .map(([layer, { layerName, nodes }]) => ({ osiLayer: layer, osiLayerName: layerName, nodes }));
}

/**
 * All InfraCI entities and their interconnections at a specific OSI layer.
 * Edges are undirected+deduped (one row per pair, endpoints key-ordered).
 */
export async function getNetworkTopologyAtLayer(osiLayer: number): Promise<{
  nodes: GraphNode[];
  edges: GraphEdge[];
}> {
  const layerStr = String(osiLayer);
  const [nodeRows, edgeRows] = await Promise.all([
    prisma.$queryRawUnsafe(
      `SELECT key, labels, props FROM graph_node
        WHERE 'InfraCI' = ANY(labels) AND props->>'osiLayer' = $1
        ORDER BY props->>'name'`,
      layerStr,
    ) as Promise<NodeRow[]>,
    prisma.$queryRawUnsafe(
      `SELECT LEAST(a.key, b.key) AS from_id, GREATEST(a.key, b.key) AS to_id,
              e.rel_type AS rel_type, e.props AS rel_props
         FROM graph_edge e
         JOIN graph_node a ON a.key = e.src_key AND 'InfraCI' = ANY(a.labels) AND a.props->>'osiLayer' = $1
         JOIN graph_node b ON b.key = e.dst_key AND 'InfraCI' = ANY(b.labels) AND b.props->>'osiLayer' = $1
        WHERE a.key <> b.key`,
      layerStr,
    ) as Promise<Array<{ from_id: string; to_id: string; rel_type: string; rel_props: Record<string, unknown> }>>,
  ]);

  return {
    nodes: nodeRows.map(nodeFromRow),
    edges: edgeRows.map((r) => ({
      from: r.from_id,
      to: r.to_id,
      type: r.rel_type,
      properties: r.rel_props,
    })),
  };
}

/** Topology scope context. Mirrors DiscoveryScopeContext at the graph layer. */
export type Neo4jTopologyScope = {
  scopeKey: string;
  customerAccountId?: string | null;
  customerSiteId?: string | null;
};

/**
 * Customer-scope variant of getNetworkTopologyAtLayer. Every InfraCI node and
 * edge endpoint must carry the supplied scopeKey (no cross-estate leakage).
 */
export async function getNetworkTopologyAtLayerForScope(
  osiLayer: number,
  scope: Neo4jTopologyScope,
): Promise<{ nodes: GraphNode[]; edges: GraphEdge[] }> {
  const layerStr = String(osiLayer);
  const [nodeRows, edgeRows] = await Promise.all([
    prisma.$queryRawUnsafe(
      `SELECT key, labels, props FROM graph_node
        WHERE 'InfraCI' = ANY(labels) AND props->>'osiLayer' = $1 AND props->>'scopeKey' = $2
        ORDER BY props->>'name'`,
      layerStr,
      scope.scopeKey,
    ) as Promise<NodeRow[]>,
    prisma.$queryRawUnsafe(
      `SELECT LEAST(a.key, b.key) AS from_id, GREATEST(a.key, b.key) AS to_id,
              e.rel_type AS rel_type, e.props AS rel_props
         FROM graph_edge e
         JOIN graph_node a ON a.key = e.src_key AND 'InfraCI' = ANY(a.labels)
              AND a.props->>'osiLayer' = $1 AND a.props->>'scopeKey' = $2
         JOIN graph_node b ON b.key = e.dst_key AND 'InfraCI' = ANY(b.labels)
              AND b.props->>'osiLayer' = $1 AND b.props->>'scopeKey' = $2
        WHERE a.key <> b.key`,
      layerStr,
      scope.scopeKey,
    ) as Promise<Array<{ from_id: string; to_id: string; rel_type: string; rel_props: Record<string, unknown> }>>,
  ]);

  return {
    nodes: nodeRows.map(nodeFromRow),
    edges: edgeRows.map((r) => ({
      from: r.from_id,
      to: r.to_id,
      type: r.rel_type,
      properties: r.rel_props,
    })),
  };
}

// ─── InfraCI helpers ─────────────────────────────────────────────────────────

/**
 * All InfraCI nodes, optionally filtered by ciType.
 * NOTE: faithful to neo4j-graph.ts — this does NOT exclude decommissioned nodes.
 */
export async function getInfraCIs(ciType?: string): Promise<GraphNode[]> {
  const rows = (ciType
    ? await prisma.$queryRawUnsafe(
        `SELECT key, labels, props FROM graph_node
          WHERE 'InfraCI' = ANY(labels) AND props->>'ciType' = $1
          ORDER BY props->>'name'`,
        ciType,
      )
    : await prisma.$queryRawUnsafe(
        `SELECT key, labels, props FROM graph_node
          WHERE 'InfraCI' = ANY(labels)
          ORDER BY props->>'name'`,
      )) as NodeRow[];
  return rows.map(nodeFromRow);
}

/**
 * Direct neighbours of a node — one hop in each relationship direction.
 * incoming: edges pointing at the node; outgoing: edges leaving the node.
 */
export async function getNeighbours(nodeKey: string): Promise<{
  incoming: Array<{ node: GraphNode; relType: string }>;
  outgoing: Array<{ node: GraphNode; relType: string }>;
}> {
  const [inRows, outRows] = await Promise.all([
    prisma.$queryRawUnsafe(
      `SELECT n.key, n.labels, n.props, e.rel_type AS type
         FROM graph_edge e
         JOIN graph_node n ON n.key = e.src_key
        WHERE e.dst_key = $1`,
      nodeKey,
    ) as Promise<Array<NodeRow & { type: string }>>,
    prisma.$queryRawUnsafe(
      `SELECT n.key, n.labels, n.props, e.rel_type AS type
         FROM graph_edge e
         JOIN graph_node n ON n.key = e.dst_key
        WHERE e.src_key = $1`,
      nodeKey,
    ) as Promise<Array<NodeRow & { type: string }>>,
  ]);

  return {
    incoming: inRows.map((r)  => ({ node: nodeFromRow(r), relType: r.type })),
    outgoing: outRows.map((r) => ({ node: nodeFromRow(r), relType: r.type })),
  };
}

/**
 * All InfraCI→InfraCI edges (both endpoints labeled InfraCI), returning endpoint
 * keys + relationship type. Replaces the Neo4j `MATCH (a:InfraCI)-[r]->(b:InfraCI)`
 * reads in the graph server actions. Optional filters mirror the former Cypher variants:
 *  - relTypes: restrict to these relationship types (e.g. HOSTS/RUNS_ON/MEMBER_OF)
 *  - osiLayer: keep edges where either endpoint sits on this OSI layer
 */
export async function getInfraEdges(opts?: {
  relTypes?: string[];
  osiLayer?: number;
}): Promise<Array<{ fromId: string; toId: string; relType: string }>> {
  const params: unknown[] = [];
  const where: string[] = [
    "'InfraCI' = ANY(sn.labels)",
    "'InfraCI' = ANY(dn.labels)",
  ];
  if (opts?.relTypes?.length) {
    params.push(opts.relTypes);
    where.push(`e.rel_type = ANY($${params.length})`);
  }
  if (opts?.osiLayer !== undefined) {
    params.push(String(opts.osiLayer));
    // osiLayer is stored as a JSON number; ->> yields its text form.
    where.push(
      `(sn.props->>'osiLayer' = $${params.length} OR dn.props->>'osiLayer' = $${params.length})`,
    );
  }
  return (await prisma.$queryRawUnsafe(
    `SELECT e.src_key AS "fromId", e.dst_key AS "toId", e.rel_type AS "relType"
       FROM graph_edge e
       JOIN graph_node sn ON sn.key = e.src_key
       JOIN graph_node dn ON dn.key = e.dst_key
      WHERE ${where.join(" AND ")}`,
    ...params,
  )) as Array<{ fromId: string; toId: string; relType: string }>;
}

/**
 * All edges whose BOTH endpoints are in the given key set — the Postgres form of the
 * Neo4j `MATCH (a)-[r]->(b) WHERE coalesce(a.ciId,a.productId) IN $ids ...` reads.
 * graph_node.key already IS the coalesced business key, so this is a straight src/dst
 * membership test. Empty input → no rows (and no query).
 */
export async function getEdgesAmong(
  nodeIds: string[],
): Promise<Array<{ fromId: string; toId: string; relType: string }>> {
  if (nodeIds.length === 0) return [];
  return (await prisma.$queryRawUnsafe(
    `SELECT src_key AS "fromId", dst_key AS "toId", rel_type AS "relType"
       FROM graph_edge
      WHERE src_key = ANY($1) AND dst_key = ANY($1)`,
    nodeIds,
  )) as Array<{ fromId: string; toId: string; relType: string }>;
}

/**
 * Remove a node and all edges touching it — the Postgres form of Neo4j
 * `MATCH (n {key}) DETACH DELETE n`. Used when a projected entity is deleted.
 */
export async function deleteGraphNode(key: string): Promise<void> {
  await prisma.$executeRawUnsafe(
    `DELETE FROM graph_edge WHERE src_key = $1 OR dst_key = $1`,
    key,
  );
  await prisma.$executeRawUnsafe(`DELETE FROM graph_node WHERE key = $1`, key);
}

/**
 * Delete every node carrying `label` plus all edges touching those nodes — the
 * Postgres form of Neo4j `MATCH (n:Label) DETACH DELETE n`. Used by the graph
 * rebuild scripts before re-projecting from Postgres.
 */
export async function clearGraphByLabel(label: string): Promise<void> {
  await prisma.$executeRawUnsafe(
    `DELETE FROM graph_edge
      WHERE src_key IN (SELECT key FROM graph_node WHERE $1 = ANY(labels))
         OR dst_key IN (SELECT key FROM graph_node WHERE $1 = ANY(labels))`,
    label,
  );
  await prisma.$executeRawUnsafe(
    `DELETE FROM graph_node WHERE $1 = ANY(labels)`,
    label,
  );
}
