// Read-only query surface for the admin graph explorer (BI-89A149A9).
//
// Reads the unified BET-5 mirror (`graph_node` / `graph_edge`, migration
// 20260714120000_bet5_graph_mirror) directly rather than any one domain's Prisma
// tables, because the whole point of the explorer is to cross corpus boundaries —
// code ↔ data model ↔ EA ↔ infrastructure — in a single view.
//
// Expansion is deliberately ITERATIVE (one bounded round-trip per hop) rather than
// a `WITH RECURSIVE` CTE. The mirror holds ~24.6k nodes and ~31.9k edges, and
// `IMPORTS` alone is 10.7k edges: a recursive walk from a hub node has no tractable
// way to stop early, while an iterative walk applies the node cap between hops and
// rides the existing `(src_key, rel_type)` / `(dst_key, rel_type)` indexes.

import { prisma } from "@dpf/db";

/** Hard ceiling on nodes returned to the canvas. The force layout is O(n²) per tick. */
export const MAX_SUBGRAPH_NODES = 400;
/** Ceiling on edges fetched per hop, so one hub node cannot stall the query. */
export const MAX_EDGES_PER_HOP = 4000;
/** Ceiling on edges returned for the final rendered subgraph. */
export const MAX_SUBGRAPH_EDGES = 2000;
export const MAX_EXPAND_DEPTH = 3;
export const DEFAULT_SEARCH_LIMIT = 25;
export const MAX_SEARCH_LIMIT = 100;

export type GraphCensus = {
  labels: Array<{ label: string; count: number }>;
  relTypes: Array<{ relType: string; count: number }>;
  nodeTotal: number;
  edgeTotal: number;
};

export type GraphNodeSummary = {
  key: string;
  labels: string[];
  name: string;
  /** Secondary identifier — a file path, model name, or the raw key. */
  detail: string | null;
};

export type GraphNodeDetail = GraphNodeSummary & {
  props: Record<string, unknown>;
  degree: number;
};

export type GraphSubgraphEdge = {
  from: string;
  to: string;
  relType: string;
};

export type GraphSubgraph = {
  nodes: GraphNodeSummary[];
  edges: GraphSubgraphEdge[];
  /** True when the node cap or edge cap clipped the result. */
  truncated: boolean;
  /** Operator-facing explanation when `truncated` is set. */
  notice: string | null;
};

export type ExpandOptions = {
  seedKeys: string[];
  depth?: number;
  /** Restrict traversal to these relationship types. Empty/omitted = all. */
  relTypes?: string[];
  /** Restrict newly-discovered neighbours to nodes carrying one of these labels. */
  labels?: string[];
  nodeCap?: number;
};

// ── Row shapes returned by the raw queries ────────────────────────────────────

type LabelCountRow = { label: string; count: bigint | number };
type RelTypeCountRow = { rel_type: string; count: bigint | number };
type TotalRow = { count: bigint | number };
type NodeRow = { key: string; labels: string[]; props: unknown };
type EdgeRow = { src_key: string; dst_key: string; rel_type: string };

function toNumber(value: bigint | number): number {
  return typeof value === "bigint" ? Number(value) : value;
}

function asProps(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

/** Display name for a node: whatever identifier the producing extractor wrote. */
export function resolveNodeName(key: string, props: Record<string, unknown>): string {
  const name = props.name;
  if (typeof name === "string" && name.trim()) return name.trim();
  const path = props.path;
  if (typeof path === "string" && path.trim()) return path.trim();
  return key;
}

/** Secondary line under the name — never a duplicate of it. */
export function resolveNodeDetail(
  key: string,
  name: string,
  props: Record<string, unknown>,
): string | null {
  const path = props.path;
  if (typeof path === "string" && path.trim() && path.trim() !== name) return path.trim();
  return key === name ? null : key;
}

function toSummary(row: NodeRow): GraphNodeSummary {
  const props = asProps(row.props);
  const name = resolveNodeName(row.key, props);
  return {
    key: row.key,
    labels: row.labels ?? [],
    name,
    detail: resolveNodeDetail(row.key, name, props),
  };
}

/** Normalize a caller-supplied filter list: trimmed, de-duped, empty => undefined. */
export function normalizeFilterList(values: string[] | undefined): string[] | undefined {
  if (!values || values.length === 0) return undefined;
  const cleaned = [...new Set(values.map((v) => v.trim()).filter(Boolean))];
  return cleaned.length > 0 ? cleaned : undefined;
}

export function clampDepth(depth: number | undefined): number {
  if (!Number.isFinite(depth ?? NaN)) return 1;
  return Math.max(1, Math.min(MAX_EXPAND_DEPTH, Math.trunc(depth as number)));
}

export function clampNodeCap(nodeCap: number | undefined): number {
  if (!Number.isFinite(nodeCap ?? NaN)) return MAX_SUBGRAPH_NODES;
  return Math.max(1, Math.min(MAX_SUBGRAPH_NODES, Math.trunc(nodeCap as number)));
}

export function clampSearchLimit(limit: number | undefined): number {
  if (!Number.isFinite(limit ?? NaN)) return DEFAULT_SEARCH_LIMIT;
  return Math.max(1, Math.min(MAX_SEARCH_LIMIT, Math.trunc(limit as number)));
}

// ── Census ────────────────────────────────────────────────────────────────────

/**
 * Label and relationship-type histogram for the whole mirror. This is both the
 * facet source for the explorer's filters and the corpus census an operator reads
 * to see how much the platform actually knows about itself.
 */
export async function getGraphCensus(): Promise<GraphCensus> {
  const [labelRows, relRows, nodeTotalRows, edgeTotalRows] = await Promise.all([
    prisma.$queryRawUnsafe<LabelCountRow[]>(
      "SELECT unnest(labels) AS label, count(*)::bigint AS count FROM graph_node GROUP BY 1 ORDER BY 2 DESC",
    ),
    prisma.$queryRawUnsafe<RelTypeCountRow[]>(
      "SELECT rel_type, count(*)::bigint AS count FROM graph_edge GROUP BY 1 ORDER BY 2 DESC",
    ),
    prisma.$queryRawUnsafe<TotalRow[]>("SELECT count(*)::bigint AS count FROM graph_node"),
    prisma.$queryRawUnsafe<TotalRow[]>("SELECT count(*)::bigint AS count FROM graph_edge"),
  ]);

  return {
    labels: labelRows.map((r) => ({ label: r.label, count: toNumber(r.count) })),
    relTypes: relRows.map((r) => ({ relType: r.rel_type, count: toNumber(r.count) })),
    nodeTotal: toNumber(nodeTotalRows[0]?.count ?? 0),
    edgeTotal: toNumber(edgeTotalRows[0]?.count ?? 0),
  };
}

// ── Search ────────────────────────────────────────────────────────────────────

/**
 * Find seed nodes by name, path, or key. Case-insensitive substring match — the
 * mirror has no full-text index, and at 24.6k rows a scan is well inside budget.
 */
export async function searchGraphNodes(input: {
  query: string;
  labels?: string[];
  limit?: number;
}): Promise<GraphNodeSummary[]> {
  const query = input.query.trim();
  if (!query) return [];

  const labels = normalizeFilterList(input.labels);
  const limit = clampSearchLimit(input.limit);
  const pattern = `%${query.replace(/[\\%_]/g, (c) => `\\${c}`)}%`;

  // $1 = LIKE pattern, $2 = the raw text (for exact-match ranking).
  const params: unknown[] = [pattern, query];
  const clauses = [
    "(n.key ILIKE $1 ESCAPE '\\' OR n.props->>'name' ILIKE $1 ESCAPE '\\' OR n.props->>'path' ILIKE $1 ESCAPE '\\')",
  ];

  if (labels) {
    params.push(labels);
    clauses.push(`n.labels && $${params.length}::text[]`);
  }

  params.push(limit);
  const rows = await prisma.$queryRawUnsafe<NodeRow[]>(
    [
      "SELECT n.key, n.labels, n.props",
      "  FROM graph_node n",
      ` WHERE ${clauses.join(" AND ")}`,
      // Ranking, verified against the live corpus: matching on NAME must beat
      // matching only on key or path. Searching "BacklogItem" otherwise returned
      // eight PrismaField rows named "id", "body", "type" — they matched on their
      // key and then won the length tiebreak — burying the model itself.
      " ORDER BY (lower(coalesce(n.props->>'name', n.key)) = lower($2)) DESC,",
      "          (coalesce(n.props->>'name', '') ILIKE $1 ESCAPE '\\') DESC,",
      "          length(coalesce(n.props->>'name', n.key)) ASC,",
      "          n.key ASC",
      ` LIMIT $${params.length}`,
    ].join("\n"),
    ...params,
  );

  return rows.map(toSummary);
}

// ── Node detail ───────────────────────────────────────────────────────────────

export async function getGraphNodeDetail(key: string): Promise<GraphNodeDetail | null> {
  const [nodeRows, degreeRows] = await Promise.all([
    prisma.$queryRawUnsafe<NodeRow[]>(
      "SELECT key, labels, props FROM graph_node WHERE key = $1",
      key,
    ),
    prisma.$queryRawUnsafe<TotalRow[]>(
      "SELECT count(*)::bigint AS count FROM graph_edge WHERE src_key = $1 OR dst_key = $1",
      key,
    ),
  ]);

  const row = nodeRows[0];
  if (!row) return null;

  return {
    ...toSummary(row),
    props: asProps(row.props),
    degree: toNumber(degreeRows[0]?.count ?? 0),
  };
}

// ── Expansion ─────────────────────────────────────────────────────────────────

async function fetchEdgesTouching(keys: string[], relTypes: string[] | undefined): Promise<EdgeRow[]> {
  const params: unknown[] = [keys];
  const clauses = ["(e.src_key = ANY($1::text[]) OR e.dst_key = ANY($1::text[]))"];
  if (relTypes) {
    params.push(relTypes);
    clauses.push(`e.rel_type = ANY($${params.length}::text[])`);
  }
  return prisma.$queryRawUnsafe<EdgeRow[]>(
    [
      "SELECT e.src_key, e.dst_key, e.rel_type",
      "  FROM graph_edge e",
      ` WHERE ${clauses.join(" AND ")}`,
      ` LIMIT ${MAX_EDGES_PER_HOP}`,
    ].join("\n"),
    ...params,
  );
}

async function fetchNodes(keys: string[]): Promise<NodeRow[]> {
  if (keys.length === 0) return [];
  return prisma.$queryRawUnsafe<NodeRow[]>(
    "SELECT key, labels, props FROM graph_node WHERE key = ANY($1::text[])",
    keys,
  );
}

async function fetchEdgesAmong(
  keys: string[],
  relTypes: string[] | undefined,
): Promise<EdgeRow[]> {
  if (keys.length === 0) return [];
  const params: unknown[] = [keys];
  const clauses = ["e.src_key = ANY($1::text[])", "e.dst_key = ANY($1::text[])"];
  if (relTypes) {
    params.push(relTypes);
    clauses.push(`e.rel_type = ANY($${params.length}::text[])`);
  }
  return prisma.$queryRawUnsafe<EdgeRow[]>(
    [
      "SELECT e.src_key, e.dst_key, e.rel_type",
      "  FROM graph_edge e",
      ` WHERE ${clauses.join(" AND ")}`,
      ` LIMIT ${MAX_SUBGRAPH_EDGES}`,
    ].join("\n"),
    ...params,
  );
}

/**
 * Breadth-first neighbourhood walk from `seedKeys`, one bounded query per hop.
 *
 * The node cap is applied BETWEEN hops, so a hub node with thousands of neighbours
 * clips at the cap instead of dragging the whole corpus onto the canvas. Seeds are
 * never filtered out by `labels` — the operator asked for them explicitly; the
 * label filter constrains only what expansion pulls in.
 */
export async function expandGraphNeighbourhood(options: ExpandOptions): Promise<GraphSubgraph> {
  const seedKeys = [...new Set(options.seedKeys.map((k) => k.trim()).filter(Boolean))];
  if (seedKeys.length === 0) {
    return { nodes: [], edges: [], truncated: false, notice: null };
  }

  const depth = clampDepth(options.depth);
  const nodeCap = clampNodeCap(options.nodeCap);
  const relTypes = normalizeFilterList(options.relTypes);
  const labels = normalizeFilterList(options.labels);

  const seedRows = await fetchNodes(seedKeys);
  if (seedRows.length === 0) {
    return { nodes: [], edges: [], truncated: false, notice: null };
  }

  const collected = new Map<string, NodeRow>(seedRows.map((r) => [r.key, r]));
  let frontier = seedRows.map((r) => r.key);
  let truncated = false;

  for (let hop = 0; hop < depth && frontier.length > 0; hop++) {
    if (collected.size >= nodeCap) {
      truncated = true;
      break;
    }

    const edges = await fetchEdgesTouching(frontier, relTypes);
    if (edges.length >= MAX_EDGES_PER_HOP) truncated = true;

    const frontierSet = new Set(frontier);
    const candidates = new Set<string>();
    for (const edge of edges) {
      const other = frontierSet.has(edge.src_key) ? edge.dst_key : edge.src_key;
      if (!collected.has(other)) candidates.add(other);
    }
    if (candidates.size === 0) break;

    const candidateRows = await fetchNodes([...candidates]);
    const admissible = labels
      ? candidateRows.filter((r) => (r.labels ?? []).some((l) => labels.includes(l)))
      : candidateRows;

    const nextFrontier: string[] = [];
    for (const row of admissible) {
      if (collected.size >= nodeCap) {
        truncated = true;
        break;
      }
      collected.set(row.key, row);
      nextFrontier.push(row.key);
    }
    frontier = nextFrontier;
  }

  const keys = [...collected.keys()];
  const edgeRows = await fetchEdgesAmong(keys, relTypes);
  if (edgeRows.length >= MAX_SUBGRAPH_EDGES) truncated = true;

  return {
    nodes: [...collected.values()].map(toSummary),
    edges: edgeRows.map((e) => ({ from: e.src_key, to: e.dst_key, relType: e.rel_type })),
    truncated,
    notice: truncated
      ? `View clipped at ${keys.length} nodes. Narrow the relationship or node-type filters, or reduce the hop depth, to see the rest.`
      : null,
  };
}
