// packages/db/src/qdrant.ts
// Singleton Qdrant vector database client — follows Neo4j pattern.

const COLLECTIONS = {
  AGENT_MEMORY: "agent-memory",
  PLATFORM_KNOWLEDGE: "platform-knowledge",
} as const;

export { COLLECTIONS as QDRANT_COLLECTIONS };

// ─── URL Resolution ─────────────────────────────────────────────────────────

function getQdrantUrl(): string {
  return (
    process.env["QDRANT_INTERNAL_URL"] ??
    process.env["QDRANT_URL"] ??
    "http://localhost:6333"
  );
}

// ─── REST Client ─────────────────────────────────────────────────────────────

async function qdrantFetch(
  path: string,
  options?: { method?: string; body?: unknown },
): Promise<unknown> {
  const url = `${getQdrantUrl()}${path}`;
  const res = await fetch(url, {
    method: options?.method ?? "GET",
    headers: { "Content-Type": "application/json" },
    body: options?.body ? JSON.stringify(options.body) : undefined,
  });
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`Qdrant ${options?.method ?? "GET"} ${path} failed (${res.status}): ${text}`);
  }
  return res.json();
}

// ─── Collection Management ──────────────────────────────────────────────────

let _collectionsEnsured = false;

export async function ensureCollections(): Promise<void> {
  if (_collectionsEnsured) return;

  const existing = (await qdrantFetch("/collections")) as {
    result?: { collections?: Array<{ name: string }> };
  };
  const names = new Set(existing.result?.collections?.map((c) => c.name) ?? []);

  if (!names.has(COLLECTIONS.AGENT_MEMORY)) {
    await qdrantFetch(`/collections/${COLLECTIONS.AGENT_MEMORY}`, {
      method: "PUT",
      body: {
        vectors: { size: 768, distance: "Cosine" },
      },
    });
    // Create payload indexes for filtering
    for (const field of ["userId", "agentId", "routeContext", "threadId"]) {
      await qdrantFetch(
        `/collections/${COLLECTIONS.AGENT_MEMORY}/index`,
        { method: "PUT", body: { field_name: field, field_schema: "keyword" } },
      ).catch(() => {}); // ignore if already exists
    }
  }

  if (!names.has(COLLECTIONS.PLATFORM_KNOWLEDGE)) {
    await qdrantFetch(`/collections/${COLLECTIONS.PLATFORM_KNOWLEDGE}`, {
      method: "PUT",
      body: {
        vectors: { size: 768, distance: "Cosine" },
      },
    });
    for (const field of ["entityType", "entityId"]) {
      await qdrantFetch(
        `/collections/${COLLECTIONS.PLATFORM_KNOWLEDGE}/index`,
        { method: "PUT", body: { field_name: field, field_schema: "keyword" } },
      ).catch(() => {});
    }
  }

  _collectionsEnsured = true;
}

// ─── Vector Operations ──────────────────────────────────────────────────────

export type VectorPoint = {
  id: string;
  vector: number[];
  payload: Record<string, unknown>;
};

export async function upsertVectors(
  collection: string,
  points: VectorPoint[],
): Promise<void> {
  await ensureCollections();
  await qdrantFetch(`/collections/${collection}/points`, {
    method: "PUT",
    body: {
      points: points.map((p) => ({
        id: hashToNumber(p.id),
        vector: p.vector,
        payload: p.payload,
      })),
    },
  });
}

export type SearchResult = {
  id: number;
  score: number;
  payload: Record<string, unknown>;
};

export async function searchSimilar(
  collection: string,
  vector: number[],
  filter?: Record<string, unknown>,
  limit = 5,
  scoreThreshold = 0.7,
): Promise<SearchResult[]> {
  await ensureCollections();
  const body: Record<string, unknown> = {
    vector,
    limit,
    score_threshold: scoreThreshold,
    with_payload: true,
  };
  if (filter) body.filter = filter;

  const result = (await qdrantFetch(`/collections/${collection}/points/search`, {
    method: "POST",
    body,
  })) as { result?: SearchResult[] };

  return result.result ?? [];
}

export async function deleteVectors(
  collection: string,
  filter: Record<string, unknown>,
): Promise<void> {
  await ensureCollections();
  await qdrantFetch(`/collections/${collection}/points/delete`, {
    method: "POST",
    body: { filter },
  });
}

// ─── Health Check ───────────────────────────────────────────────────────────

export async function isQdrantHealthy(): Promise<boolean> {
  try {
    await qdrantFetch("/readyz");
    return true;
  } catch {
    return false;
  }
}

// ─── Scroll (filter-only) ───────────────────────────────────────────────────

/**
 * Scroll-based point lookup with payload filters. No embedding vector required.
 * Use this for exact-match lookups (e.g., "find all capabilities with action_name X").
 * Distinct from searchSimilar() which requires an embedding vector.
 */
export async function scrollPoints(
  collection: string,
  filter: Record<string, unknown>,
  limit = 100,
): Promise<Array<{ id: number; payload: Record<string, unknown> }>> {
  // ensureCollections() not called — scroll is read-only; callers must ensure startup order
  const result = await qdrantFetch(
    `/collections/${collection}/points/scroll`,
    {
      method: "POST",
      body: { filter, limit, with_payload: true },
    },
  ) as { result?: { points?: Array<{ id: number; payload: Record<string, unknown> }> } };
  return result.result?.points ?? [];
}

// ─── Payload Indexes ───────────────────────────────────────────────────────

/**
 * Idempotently ensures all required payload indexes exist on platform-knowledge.
 * Qdrant PUT index ignores duplicates, so this is safe to call on every startup.
 * Separate from ensureCollections() because indexes need to be added to
 * existing collections, not just new ones.
 */
export async function ensurePayloadIndexes(): Promise<void> {
  const keywordFields = ["route", "lifecycle_status", "action_name", "spec_ref"];
  const boolFields = ["side_effect"];

  for (const field of keywordFields) {
    await qdrantFetch(
      `/collections/${COLLECTIONS.PLATFORM_KNOWLEDGE}/index`,
      { method: "PUT", body: { field_name: field, field_schema: "keyword" } },
    ).catch((err) => { console.warn("ensurePayloadIndexes: failed to create index for", field, err); });
  }

  for (const field of boolFields) {
    await qdrantFetch(
      `/collections/${COLLECTIONS.PLATFORM_KNOWLEDGE}/index`,
      { method: "PUT", body: { field_name: field, field_schema: "bool" } },
    ).catch((err) => { console.warn("ensurePayloadIndexes: failed to create index for", field, err); });
  }
}

// ─── Helpers ────────────────────────────────────────────────────────────────

/** Convert string ID to numeric hash for Qdrant (which prefers numeric IDs) */
export function hashToNumber(str: string): number {
  let hash = 0;
  for (let i = 0; i < str.length; i++) {
    const char = str.charCodeAt(i);
    hash = ((hash << 5) - hash + char) | 0;
  }
  return Math.abs(hash);
}
