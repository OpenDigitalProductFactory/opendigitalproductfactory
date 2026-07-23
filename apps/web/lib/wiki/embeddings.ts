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
  // ─── Principle-only payload fields ────────────────────────────────────────
  // Only meaningful when `pageKind === "principle"`. Used by Phase 2 retrieval
  // filters (`recallPrincipleContext`, `wiki_query` tier/appliesTo). Stored
  // as canonical key names (no short aliases) per the chief-architect review
  // applied to docs/superpowers/plans/2026-05-12-principles-as-wiki-kind.md.
  // The dimension VECTOR (signed weights) lives in Postgres only — it's
  // decision-time data, not a retrieval filter axis. The dimension KEY LIST
  // surfaces in Qdrant so filters can scope retrieval to principles that
  // care about a given axis.
  principleTier?: string | null;
  principleAppliesTo?: string[];
  /**
   * Ring scope (BI-4AA1074B Slice 2; spec §5.2). Stored as Qdrant payload so
   * recall callers can pre-filter by intersection without a Postgres
   * round-trip per hit.
   */
  principleRingScope?: string[];
  principleDimensions?: string[];
  principlePublic?: boolean;
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
  // ─── Principle-only metadata (populated when pageKind === "principle") ────
  // Surfaced from the Qdrant payload written by storeWikiPage. Absent for
  // non-principle pages so callers can branch on pageKind === "principle"
  // to decide whether to render metadata.
  principleTier?: string;
  principleAppliesTo?: string[];
  principleRingScope?: string[];
  principleDimensions?: string[];
  principlePublic?: boolean;
};

export type SearchWikiPagesInput = {
  query: string;
  /** Set for tenant context. Pass `null` to search kernel only. */
  organizationId: string | null;
  /** Optional filter to one page kind. */
  pageKind?: string;
  /**
   * Optional OR-filter across several page kinds (Qdrant `match: { any }`).
   * Used for perspective-biased recall (WWMD/WWWD) where stance/heuristic/etc.
   * should be preferred. Takes precedence over `pageKind` when both are set.
   */
  pageKinds?: string[];
  /** Total results to return across both passes. Default 5. */
  limit?: number;
  /** Cosine score threshold per pass. Default 0.55, matching `searchKnowledgeArticles`. */
  scoreThreshold?: number;
  // ─── Principle-only filters (Phase 2 of principles-as-wiki-kind) ──────────
  // Translated to Qdrant payload-key matchers against the canonical principle
  // payload keys written by storeWikiPage when pageKind === "principle". Use
  // alongside `pageKind: "principle"` for the typical retrieval path.
  // `principleAppliesTo` performs array-containment matching: Qdrant's
  // `match: { value: "human" }` against an array payload key returns rows
  // whose array contains that value.
  /** Restrict to one tier: commandment | core | contextual. */
  principleTier?: string;
  /** Restrict to principles whose appliesTo array contains this population. */
  principleAppliesTo?: string;
  /** Restrict to principles with this public-classification state. */
  principlePublic?: boolean;
  /**
   * Restrict to principles whose `principleRingScope` intersects the caller
   * scope, OR is empty (backward-compat), OR contains `universal-ring`.
   * BI-4AA1074B Slice 2 / spec §5.2.
   *
   * Caller passes the FULL caller scope (e.g. `["ring-2-workflow"]`); this
   * function builds a Qdrant `should` clause so the intersection check
   * happens in the vector store, not in JS post-filter. When the caller
   * scope contains `universal-ring`, the filter is a no-op (caller is open).
   */
  principleRingScope?: string[];
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

  // Build the base payload first, then conditionally add principle-only
  // keys when the caller supplied them. Absence is the marker that a
  // payload does not carry principle metadata; we never write
  // `principleTier: null` or empty arrays for non-principle pages because
  // that would force a backfill of every existing Qdrant payload and
  // muddle filter semantics. See spec section 5.5 and the chief-architect
  // review applied to the implementation plan.
  const payload: Record<string, unknown> = {
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
  };

  if (input.pageKind === "principle") {
    if (input.principleTier !== undefined && input.principleTier !== null) {
      payload.principleTier = input.principleTier;
    }
    if (input.principleAppliesTo !== undefined) {
      payload.principleAppliesTo = input.principleAppliesTo;
    }
    if (input.principleRingScope !== undefined) {
      payload.principleRingScope = input.principleRingScope;
    }
    if (input.principleDimensions !== undefined) {
      payload.principleDimensions = input.principleDimensions;
    }
    if (input.principlePublic !== undefined) {
      payload.principlePublic = input.principlePublic;
    }
  }

  await upsertVectors(QDRANT_COLLECTIONS.WIKI_PAGES, [
    {
      id: `wiki-page-${input.pageId}`,
      vector,
      payload,
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
  if (!vector) {
    // BI-512FBD20. A null vector means the query could not be embedded — the
    // provider is down or the model is missing. Returning [] here is
    // indistinguishable, to the caller, from "no page matched", which is how
    // wiki_query and principle_decide silently degraded to empty results while
    // reporting themselves healthy. The [] contract stays (callers expect it),
    // but the failure is now loud in the logs with a distinct, greppable marker
    // and the exact fix. `make-silent-failures-observable`.
    console.error(
      "[searchWikiPages] embedding-provider-unavailable — query could not be " +
        "embedded, returning no results (NOT an empty match). " +
        "Fix: docker model pull ai/nomic-embed-text-v1.5",
    );
    return [];
  }

  const limit = input.limit ?? 5;
  const scoreThreshold = input.scoreThreshold ?? 0.55;

  // Qdrant accepts richer match shapes than just `{value: scalar}` — the
  // ring-scope `should` clause below uses `match: {any: [...]}` for OR
  // semantics across array-containment matches. Loosen the local type so
  // both shapes coexist; runtime contract is unchanged.
  const baseFilter: Array<{
    key: string;
    match: { value: string | boolean } | { any: string[] };
  }> = [
    { key: "entityType", match: { value: ENTITY_TYPE } },
    { key: "status", match: { value: "published" } },
  ];
  if (input.pageKinds && input.pageKinds.length > 0) {
    baseFilter.push({ key: "pageKind", match: { any: input.pageKinds } });
  } else if (input.pageKind) {
    baseFilter.push({ key: "pageKind", match: { value: input.pageKind } });
  }
  // Principle-only filters. Translated to Qdrant payload-key matchers
  // against the canonical principle keys (principleTier, principleAppliesTo,
  // principlePublic) written by storeWikiPage. principleAppliesTo matches
  // by array containment — Qdrant treats `match: { value: X }` against an
  // array payload as "X is in the array".
  if (input.principleTier !== undefined) {
    baseFilter.push({
      key: "principleTier",
      match: { value: input.principleTier },
    });
  }
  if (input.principleAppliesTo !== undefined) {
    baseFilter.push({
      key: "principleAppliesTo",
      match: { value: input.principleAppliesTo },
    });
  }
  if (input.principlePublic !== undefined) {
    baseFilter.push({
      key: "principlePublic",
      match: { value: input.principlePublic },
    });
  }

  // Ring-scope filter (BI-4AA1074B Slice 2; spec §5.2). Built as a
  // Qdrant `should` clause so any ONE of the conditions can match:
  //   - principle's ring scope contains `universal-ring` (earned-universal)
  //   - principle's ring scope contains any caller-scope value
  // Skipped entirely when:
  //   - caller passed no ringScope (no constraint)
  //   - caller passed `universal-ring` (caller opted out of tightening)
  //
  // Note: empty `principleRingScope` arrays pass via post-filter in
  // `recallPrincipleContext` rather than via Qdrant — Qdrant filters can't
  // easily express "empty-array OR has-X" without breaking the should/must
  // semantics. The post-filter is an additive safety net for un-backfilled
  // rows; today's kernel (62/62 backfilled) doesn't depend on it.
  const ringScopeShould: typeof baseFilter = [];
  if (
    input.principleRingScope !== undefined &&
    input.principleRingScope.length > 0 &&
    !input.principleRingScope.includes("universal-ring")
  ) {
    ringScopeShould.push({
      key: "principleRingScope",
      match: { value: "universal-ring" },
    });
    ringScopeShould.push({
      key: "principleRingScope",
      match: { any: input.principleRingScope },
    });
  }

  // ── Pass A — org-scoped, only when an organization is in context ──
  let orgResults: WikiSearchResult[] = [];
  if (input.organizationId !== null) {
    const orgFilter: Record<string, unknown> = {
      must: [
        ...baseFilter,
        { key: "organizationId", match: { value: input.organizationId } },
      ],
    };
    if (ringScopeShould.length > 0) orgFilter.should = ringScopeShould;
    const orgRaw = await searchSimilar(
      QDRANT_COLLECTIONS.WIKI_PAGES,
      vector,
      orgFilter,
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
  if (ringScopeShould.length > 0) kernelFilter.should = ringScopeShould;

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
  const result: WikiSearchResult = {
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
  // Pass through principle payload keys when present so MCP responses can
  // surface principle metadata without an extra Postgres round-trip. Only
  // principle pages carry these keys (per storeWikiPage's write path).
  if (typeof r.payload["principleTier"] === "string") {
    result.principleTier = r.payload["principleTier"];
  }
  if (Array.isArray(r.payload["principleAppliesTo"])) {
    result.principleAppliesTo = r.payload["principleAppliesTo"] as string[];
  }
  if (Array.isArray(r.payload["principleRingScope"])) {
    result.principleRingScope = r.payload["principleRingScope"] as string[];
  }
  if (Array.isArray(r.payload["principleDimensions"])) {
    result.principleDimensions = r.payload["principleDimensions"] as string[];
  }
  if (typeof r.payload["principlePublic"] === "boolean") {
    result.principlePublic = r.payload["principlePublic"];
  }
  return result;
}
