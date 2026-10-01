// Vector store on Postgres + pgvector. Exports VECTOR_COLLECTIONS, VectorPoint,
// SearchResult, upsertVectors, searchSimilar, deleteVectors, scrollPoints,
// hashToNumber, ensureCollections, ensurePayloadIndexes and isVectorStoreHealthy.
// Vectors live in the `vector_embedding` table (see the 20260714110000 migration);
// access is raw SQL because Prisma can't model the `vector` type.

import { prisma } from "./client";

const COLLECTIONS = {
  AGENT_MEMORY: "agent-memory",
  PLATFORM_KNOWLEDGE: "platform-knowledge",
  WIKI_PAGES: "wiki-pages",
  DOCUMENTS: "documents",
} as const;

export { COLLECTIONS as VECTOR_COLLECTIONS };

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

/** Stable string→numeric id, so a point id never changes for the same source key. */
export function hashToNumber(str: string): number {
  let hash = 0;
  for (let i = 0; i < str.length; i++) {
    const char = str.charCodeAt(i);
    hash = ((hash << 5) - hash + char) | 0;
  }
  return Math.abs(hash);
}

// ─── Filter DSL → SQL ────────────────────────────────────────────────────────
// Callers pass filters shaped { must?, should?, must_not? } where a
// Clause is { key, match: { value } | { any: [...] } } and `value` may be null.
// `must` = AND, `should` = OR, `must_not` = AND of negations. Payload values may be
// scalars OR arrays (a value matches an array key by containment), so
// each equality checks both. Exported so app-side callers can type their clause arrays.
export type MatchClause = {
  key: string;
  match: { value?: unknown } | { any?: unknown[] };
};
export type VectorFilter = {
  must?: MatchClause[];
  should?: MatchClause[];
  must_not?: MatchClause[];
};

/** Exported for unit testing the translation without a database. */
export function buildFilterSql(
  filter: VectorFilter,
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
      // match:{value:null} → key absent or JSON null.
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
  if (filter.must_not?.length) {
    // must_not: the row must not match ANY negated clause → AND of NOTs.
    parts.push(filter.must_not.map((c) => `NOT ${clauseSql(c)}`).join(" AND "));
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
  filter?: VectorFilter,
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
  filter: VectorFilter,
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
  filter: VectorFilter,
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

export async function isVectorStoreHealthy(): Promise<boolean> {
  try {
    await prisma.$queryRawUnsafe("SELECT 1");
    return true;
  } catch {
    return false;
  }
}
