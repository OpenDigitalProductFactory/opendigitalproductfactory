// EP-WIKI-001 Phase 2a: Qdrant write + overlay-aware read helpers for
// the wiki kernel + per-org overlay.
// Spec: docs/superpowers/specs/2026-05-09-platform-kernel-wiki-design.md §5
// Plan: docs/superpowers/plans/2026-05-09-platform-kernel-wiki.md (Phase 2)
//
// These helpers are the data-layer floor for both the ingest pipeline
// (Phase 2b — `ingest.ts`) and the query path (Phase 3 —
// `recallWikiContext()` + `wiki_query` MCP tool). They are split from
// `ingest.ts` because they are pure data-layer code with no LLM
// dependency, simpler to test, and consumed by multiple downstream
// surfaces.

import { QDRANT_COLLECTIONS, upsertVectors, searchSimilar, deleteVectors } from "@dpf/db";
import { generateEmbedding } from "@/lib/inference/embedding";

// ─── Constants ──────────────────────────────────────────────────────────────

/** Max input length to embed. Matches the cap in `generateEmbedding`. */
const MAX_EMBED_LENGTH = 8000;

/** entityType value used in the wiki-pages collection payload. */
const ENTITY_TYPE = "wiki-page";

// ─── Types ──────────────────────────────────────────────────────────────────

/** Subset of `WikiPage` columns needed to write the Qdrant point. */
export type StoreWikiPageInput = {
  pageId: string;
  slug: string;
  title: string;
  body: string;
  abstract: string | null;
  pageKind: string;
  status: string;
  isKernel: boolean;
  kernelVersion: string | null;
  organizationId: string | null;
  kernelPageId: string | null;
};

export type WikiSearchResult = {
  pageId: string;
  slug: string;
  title: string;
  pageKind: string;
  contentPreview: string;
  isKernel: boolean;
  organizationId: string | null;
  kernelPageId: string | null;
  /** Cosine score from Qdrant. */
  score: number;
  /** Which retrieval pass surfaced this row: "org" or "kernel". */
  source: "org" | "kernel";
};

export type SearchWikiPagesInput = {
  query: string;
  /** Set for tenant context. Pass `null` to search kernel only. */
  organizationId: string | null;
  /** Optional filter to one page kind. */
  pageKind?: string;
  /** Total results to return across both passes. Default 5. */
  limit?: number;
  /** Cosine score threshold per pass. Default 0.55, matching `searchKnowledgeArticles`. */
  scoreThreshold?: number;
};

// ─── Write ──────────────────────────────────────────────────────────────────

/**
 * Upsert a wiki page into the `wiki-pages` Qdrant collection. Embeds
 * `abstract + "\n\n" + body` (truncated to 8000 chars per spec §5).
 *
 * Returns `false` if the embedding could not be generated (Ollama
 * down or model missing) — the page still exists in Postgres; the
 * Qdrant index is best-effort and rebuilds on next ingest. Matches
 * the silent-degradation pattern used by `recallRelevantContext`.
 */
export async function storeWikiPage(input: StoreWikiPageInput): Promise<boolean> {
  const embeddingInput = [input.abstract ?? "", input.body].filter(Boolean).join("\n\n");
  const truncated = embeddingInput.slice(0, MAX_EMBED_LENGTH);
  const vector = await generateEmbedding(truncated);
  if (!vector) return false;

  await upsertVectors(QDRANT_COLLECTIONS.WIKI_PAGES, [
    {
      id: `wiki-page-${input.pageId}`,
      vector,
      payload: {
        entityType: ENTITY_TYPE,
        entityId: input.pageId,
        slug: input.slug,
        title: input.title,
        contentPreview: input.body.slice(0, 500),
        pageKind: input.pageKind,
        status: input.status,
        isKernel: input.isKernel,
        // Qdrant payload null vs missing matters for keyword filters:
        // kernel rows have organizationId = null, which the filter
        // builder represents as `match: { value: null }`.
        organizationId: input.organizationId,
        kernelVersion: input.kernelVersion,
        kernelPageId: input.kernelPageId,
        timestamp: new Date().toISOString(),
      },
    },
  ]);
  return true;
}

// ─── Delete ─────────────────────────────────────────────────────────────────

/**
 * Remove a wiki page's Qdrant point. Called on hard delete and on
 * archive flows that want the page hidden from retrieval immediately.
 */
export async function deleteWikiPageVector(pageId: string): Promise<void> {
  await deleteVectors(QDRANT_COLLECTIONS.WIKI_PAGES, {
    must: [{ key: "entityId", match: { value: pageId } }],
  });
}

// ─── Read (two-pass overlay-aware) ──────────────────────────────────────────

/**
 * Two-pass overlay-aware semantic search per spec §5:
 *   Pass A — org-scoped rows for the requesting tenant
 *   Pass B — kernel rows, excluding any `kernelPageId` already
 *            returned by pass A (the org override masks the kernel
 *            page from this tenant's view)
 *
 * Per-tenant isolation is enforced by the Qdrant `organizationId`
 * payload filter — a wrong `organizationId` in the input cannot
 * surface another tenant's overlay.
 *
 * Returns up to `limit` results, drawn first from pass A, then
 * pass B; published rows only.
 */
export async function searchWikiPages(input: SearchWikiPagesInput): Promise<WikiSearchResult[]> {
  const vector = await generateEmbedding(input.query);
  if (!vector) return [];

  const limit = input.limit ?? 5;
  const scoreThreshold = input.scoreThreshold ?? 0.55;

  const baseFilter = [
    { key: "entityType", match: { value: ENTITY_TYPE } },
    { key: "status", match: { value: "published" } },
  ];
  if (input.pageKind) {
    baseFilter.push({ key: "pageKind", match: { value: input.pageKind } });
  }

  // ── Pass A — org-scoped, only when an organization is in context ──
  let orgResults: WikiSearchResult[] = [];
  if (input.organizationId !== null) {
    const orgRaw = await searchSimilar(
      QDRANT_COLLECTIONS.WIKI_PAGES,
      vector,
      {
        must: [...baseFilter, { key: "organizationId", match: { value: input.organizationId } }],
      },
      limit,
      scoreThreshold,
    );
    orgResults = orgRaw.map((r) => projectResult(r, "org"));
  }

  if (orgResults.length >= limit) return orgResults.slice(0, limit);

  // ── Pass B — kernel fallback, masking any kernel pages the org has overridden ──
  // The set of kernelPageIds claimed by pass A (org rows that override kernel pages).
  const maskedKernelPageIds = orgResults
    .map((r) => r.kernelPageId)
    .filter((id): id is string => id !== null);

  const kernelFilter: Record<string, unknown> = {
    must: [...baseFilter, { key: "isKernel", match: { value: true } }],
  };
  if (maskedKernelPageIds.length > 0) {
    kernelFilter.must_not = [
      { key: "entityId", match: { any: maskedKernelPageIds } },
    ];
  }

  const remaining = limit - orgResults.length;
  const kernelRaw = await searchSimilar(
    QDRANT_COLLECTIONS.WIKI_PAGES,
    vector,
    kernelFilter,
    remaining,
    scoreThreshold,
  );
  const kernelResults = kernelRaw.map((r) => projectResult(r, "kernel"));

  return [...orgResults, ...kernelResults].slice(0, limit);
}

// ─── Internal ───────────────────────────────────────────────────────────────

function projectResult(
  r: { score: number; payload: Record<string, unknown> },
  source: "org" | "kernel",
): WikiSearchResult {
  return {
    pageId: String(r.payload["entityId"] ?? ""),
    slug: String(r.payload["slug"] ?? ""),
    title: String(r.payload["title"] ?? ""),
    pageKind: String(r.payload["pageKind"] ?? ""),
    contentPreview: String(r.payload["contentPreview"] ?? ""),
    isKernel: Boolean(r.payload["isKernel"]),
    organizationId: (r.payload["organizationId"] as string | null) ?? null,
    kernelPageId: (r.payload["kernelPageId"] as string | null) ?? null,
    score: r.score,
    source,
  };
}
