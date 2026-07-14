// BET-5 (BI-A1E864A5): pgvector-backed vector store, a drop-in replacement for qdrant.ts.
// Reimplements the same exported surface (QDRANT_COLLECTIONS, VectorPoint, SearchResult,
// upsertVectors, searchSimilar, deleteVectors, scrollPoints, hashToNumber, ensureCollections,
// ensurePayloadIndexes, isQdrantHealthy) on Postgres + pgvector so the ~dozen call sites in
// wiki/inference/documents/sandbox migrate with an import swap. Vectors live in the
// `vector_embedding` table (see the 20260714110000 migration); access is raw SQL because
// Prisma can't model the `vector` type.
//
// NOT YET WIRED: callers still import from ./qdrant until the cutover repoints them behind a
// flag and the A/B parity check (pgvector vs live Qdrant) passes.

import { prisma } from "./client";

const COLLECTIONS = {
  AGENT_MEMORY: "agent-memory",
  PLATFORM_KNOWLEDGE: "platform-knowledge",
  WIKI_PAGES: "wiki-pages",
  DOCUMENTS: "documents",
} as const;

export { COLLECTIONS as QDRANT_COLLECTIONS };

export type VectorPoint = {
  id: string;
  vector: number[];
  payload: Record<string, unknown>;
};

export type SearchResult = {
  id: number;
  score: number;
  payload: Record<string, unknown>;
};

/** Identical to qdrant.ts: stable string→numeric id so point ids match across the cutover. */
export function hashToNumber(str: string): number {
  let hash = 0;
  for (let i = 0; i < str.length; i++) {
    const char = str.charCodeAt(i);
    hash = ((hash << 5) - hash + char) | 0;
  }
  return Math.abs(hash);
}

// ─── Qdrant filter DSL → SQL ─────────────────────────────────────────────────
// Callers pass Qdrant-shaped filters: { must?: Clause[], should?: Clause[] } where a
// Clause is { key, match: { value } | { any: [...] } } and `value` may be null.
// `must` = AND, `should` = OR. Payload values may be scalars OR arrays (Qdrant matches a
// value against an array key by containment), so each equality checks both.

type MatchClause = { key: string; match: { value?: unknown } | { any?: unknown[] } };
type QdrantFilter = { must?: MatchClause[]; should?: MatchClause[] };

/** Exported for unit testing the translation without a database. */
export function buildFilterSql(
  filter: QdrantFilter,
  params: unknown[],
): string {
  const clauseSql = (c: MatchClause): string => {
    const keyLit = `'${c.key.replace(/'/g, "''")}'`;
    if ("any" in c.match && Array.isArray(c.match.any)) {
      // OR over the allowed values: scalar-equality OR array-containment.
      const ors = c.match.any.map((v) => {
        params.push(JSON.stringify(v));
        const p = `$${params.length}::jsonb`;
        return `(payload->${keyLit} = ${p} OR payload->${keyLit} @> ${p})`;
      });
      return ors.length ? `(${ors.join(" OR ")})` : "false";
    }
    const value = (c.match as { value?: unknown }).value;
    if (value === null) {
      // Qdrant match:{value:null} → key absent or JSON null.
      return `(NOT (payload ? ${keyLit}) OR payload->${keyLit} = 'null'::jsonb)`;
    }
    params.push(JSON.stringify(value));
    const p = `$${params.length}::jsonb`;
    return `(payload->${keyLit} = ${p} OR payload->${keyLit} @> ${p})`;
  };

  const parts: string[] = [];
  if (filter.must?.length) {
    parts.push(filter.must.map(clauseSql).join(" AND "));
  }
  if (filter.should?.length) {
    parts.push(`(${filter.should.map(clauseSql).join(" OR ")})`);
  }
  return parts.length ? `AND ${parts.join(" AND ")}` : "";
}

function vectorLiteral(vector: number[]): string {
  return `[${vector.join(",")}]`;
}

// ─── Write path ──────────────────────────────────────────────────────────────

export async function ensureCollections(): Promise<void> {
  // No-op: the vector_embedding table + indexes are created by the migration.
}

export async function ensurePayloadIndexes(): Promise<void> {
  // No-op: the payload GIN index covers all payload filters (no per-field index needed).
}

export async function upsertVectors(
  collection: string,
  points: VectorPoint[],
): Promise<void> {
  if (points.length === 0) return;
  for (const p of points) {
    await prisma.$executeRawUnsafe(
      `INSERT INTO vector_embedding (collection, point_id, embedding, payload)
       VALUES ($1, $2, $3::vector, $4::jsonb)
       ON CONFLICT (collection, point_id)
       DO UPDATE SET embedding = EXCLUDED.embedding, payload = EXCLUDED.payload`,
      collection,
      hashToNumber(p.id),
      vectorLiteral(p.vector),
      JSON.stringify(p.payload),
    );
  }
}

// ─── Read path ───────────────────────────────────────────────────────────────

export async function searchSimilar(
  collection: string,
  vector: number[],
  filter?: QdrantFilter,
  limit = 5,
  scoreThreshold = 0.7,
): Promise<SearchResult[]> {
  const params: unknown[] = [vectorLiteral(vector), collection];
  const filterSql = filter ? buildFilterSql(filter, params) : "";
  // Cosine similarity = 1 - cosine_distance. HNSW ORDER BY <=> uses the per-collection index.
  const rows = (await prisma.$queryRawUnsafe(
    `SELECT point_id AS id, 1 - (embedding <=> $1::vector) AS score, payload
       FROM vector_embedding
      WHERE collection = $2 ${filterSql}
        AND 1 - (embedding <=> $1::vector) >= ${Number(scoreThreshold)}
      ORDER BY embedding <=> $1::vector
      LIMIT ${Math.trunc(Number(limit))}`,
    ...params,
  )) as Array<{ id: bigint | number; score: number; payload: Record<string, unknown> }>;
  return rows.map((r) => ({
    id: Number(r.id),
    score: Number(r.score),
    payload: r.payload,
  }));
}

export async function deleteVectors(
  collection: string,
  filter: QdrantFilter,
): Promise<void> {
  const params: unknown[] = [collection];
  const filterSql = filter ? buildFilterSql(filter, params) : "";
  await prisma.$executeRawUnsafe(
    `DELETE FROM vector_embedding WHERE collection = $1 ${filterSql}`,
    ...params,
  );
}

export async function scrollPoints(
  collection: string,
  filter: QdrantFilter,
  limit = 100,
): Promise<Array<{ id: number; payload: Record<string, unknown> }>> {
  const params: unknown[] = [collection];
  const filterSql = filter ? buildFilterSql(filter, params) : "";
  const rows = (await prisma.$queryRawUnsafe(
    `SELECT point_id AS id, payload FROM vector_embedding
      WHERE collection = $1 ${filterSql}
      LIMIT ${Math.trunc(Number(limit))}`,
    ...params,
  )) as Array<{ id: bigint | number; payload: Record<string, unknown> }>;
  return rows.map((r) => ({ id: Number(r.id), payload: r.payload }));
}

export async function isQdrantHealthy(): Promise<boolean> {
  try {
    await prisma.$queryRawUnsafe("SELECT 1");
    return true;
  } catch {
    return false;
  }
}
