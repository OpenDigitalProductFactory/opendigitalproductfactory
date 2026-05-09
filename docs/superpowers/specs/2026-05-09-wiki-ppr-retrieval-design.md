# EP-WIKI-004: Personalized PageRank Retrieval Over the Wiki-Link Graph

| Field | Value |
|-------|-------|
| **Epic** | EP-WIKI-004 |
| **Builds on** | [EP-WIKI-001 — Platform Kernel Wiki + Per-Org Overlay](2026-05-09-platform-kernel-wiki-design.md) |
| **Depends on** | EP-WIKI-001 Phase 3 (query path shipped, `recallWikiContext` and `wiki_query` MCP tool live) |
| **Status** | Draft (research follow-up) |
| **Created** | 2026-05-09 |
| **Author** | Mark Bodman + Claude (design partner) |
| **Inspiration** | HippoRAG / HippoRAG 2 — *Neurobiologically Inspired Long-Term Memory for Large Language Models* (<https://arxiv.org/abs/2405.14831>, <https://arxiv.org/html/2502.14802v1>); LightRAG dual-level keyword decomposition (<https://arxiv.org/abs/2410.05779>) |

---

## 0. Relationship to Existing Memory Infrastructure

Added 2026-05-09 after review of prior specs in `docs/superpowers/specs/`. PPR layers **on top of** the existing Qdrant similarity search introduced by [EP-MEMORY-001 (2026-03-17)](2026-03-17-shared-memory-vector-db-design.md), not parallel to it:

- Vector seeds come from the existing `searchWikiPages()` helper (post-EP-WIKI-001 §11 migration; previously `searchKnowledgeArticles()` against the `platform-knowledge` Qdrant collection).
- The recognition-memory pre-filter is a normal LLM tool call — no new infrastructure.
- The per-tenant subgraph is built from the `WikiPageLink` table introduced by [EP-WIKI-001 §4](2026-05-09-platform-kernel-wiki-design.md). No new edge store.
- Embedding model stays `nomic-embed-text` (768-dim, Ollama). No parallel embedding pipeline.
- PPR results are still classified as `archival_knowledge` retrieval (per the five-class model in [EP-TAK-3F9A21 §5.7](2026-04-25-tak-gaid-auth-identity-memory-refresh-design.md)), inherit the same freshness gates per TAK §12.5, and remain advisory until validated for consequential actions.

This is the cleanest of the three follow-up specs against the existing infrastructure — it adds a re-rank stage and a per-tenant in-memory graph cache, nothing else.

---

## 1. Problem

EP-WIKI-001's retrieval is vector-only: `searchWikiPages()` does a two-pass overlay-aware cosine search and returns top-K. This misses **second-order relevance** — pages that don't match the query directly but are linked from pages that do, or that link to pages that do. Multi-hop questions ("how do these two stances interact across portfolios") are exactly the questions an org's overlay should be able to answer, and they're exactly what vector-only retrieval is bad at.

EP-WIKI-001 deferred Neo4j projection of the wiki graph to V2. HippoRAG 2 shows that for relevance-ranking purposes (not transitive traversal) we don't need a graph DB — **Personalized PageRank over the link graph we already build** delivers most of the multi-hop benefit, runs in-process over the existing Postgres `WikiPageLink` table, and stays per-tenant by construction.

This spec adds PPR-augmented retrieval as an alternative path, behind a feature flag, with no new storage.

---

## 2. Design

### 2.1 The PPR Algorithm

Personalized PageRank computes a stationary distribution over a graph where the random walk **resets to a chosen seed set** with probability `α` (typically 0.15). Pages near the seeds in the link graph score higher. Unlike global PageRank, PPR is query-specific — different seeds produce different rankings.

For our wiki:
- **Nodes**: `WikiPage` rows visible to the requesting org (kernel + overlay; standard EP-WIKI-001 visibility).
- **Edges**: `WikiPageLink` rows where both endpoints are visible.
- **Seeds**: the top-K pages from the existing vector search, with reset probabilities weighted by their cosine scores.

### 2.2 Query Flow

1. **Vector seed phase.** Existing `searchWikiPages({ query, organizationId, limit: 20 })` returns 20 candidate pages with cosine scores.
2. **Recognition memory pre-filter.** Cheap LLM pass: "Of these 20 pages, which are actually relevant to the query?" Drops obviously irrelevant candidates. Surviving set (typically 5–10) becomes the PPR seed set. Rationale: PPR amplifies signal *and* noise; pre-filtering the seeds matters more than re-ranking the output.
3. **PPR computation.** Run PPR over the per-tenant subgraph using `graphology` + `graphology-pagerank` (or equivalent in-process JS lib). Reset probabilities = normalized cosine scores of surviving seeds. Iterate to convergence (~20 iterations).
4. **Combine and rank.** For each page in the PPR result, compute `score = β × pprScore + (1 − β) × cosineScore`. Default `β = 0.6` (favor PPR but keep cosine grounding). Return top-N.

### 2.3 Per-Tenant Subgraph Cache

Building the subgraph from Postgres on every query is wasteful. Cache per-tenant subgraphs in Redis (or in-memory if footprint allows):

```
key:   wiki:graph:<orgId>:<kernelVersion>
value: { nodes: string[], edges: [string, string][], builtAt: ISOString }
```

Invalidate when any `WikiPage` or `WikiPageLink` for that tenant changes. Rebuild lazily on next query. For tenants > 10k pages, keep adjacency-list shape and consider partial PPR (Monte Carlo with k random walks).

### 2.4 Dual-Level Keyword Decomposition (Optional, LightRAG-Style)

For genuinely multi-hop questions, the seed set can be richer if we ask the LLM to decompose the query into:

- **Specific keywords** (entity names, slugs) → looked up by exact match.
- **Thematic keywords** (high-level concepts) → looked up by vector match.

Both contribute to the seed set. One extra LLM call per query; useful when query length > 20 tokens or contains "and", "across", "compare", "interact". Behind a sub-flag (`enableDualLevelDecomposition`).

### 2.5 Where It Plugs In

- **`apps/web/lib/wiki/ppr.ts`** (new): `searchByPPR({ query, organizationId, seeds, beta })`.
- **`apps/web/lib/wiki/recall.ts`** (modify `recallWikiContext`): if `enablePPR` flag is true for the org, route through `searchByPPR` instead of `searchWikiPages` directly.
- **`apps/web/lib/mcp-tools.ts`**: `wiki_query` accepts an optional `retrievalMode: "vector" | "ppr"` parameter; defaults to org config.

### 2.6 Feature Flagging

Per-org toggle on the `Organization` model (or `OrgSettings` if it exists):

```prisma
wikiRetrievalMode String @default("vector") // "vector" | "ppr"
```

Allows A/B comparison and gradual rollout.

---

## 3. Why This Is Better

- **Multi-hop retrieval without a graph DB.** PPR captures the "neighbors of relevant pages are also relevant" intuition that vector search misses. Uses the link graph we already build for free.
- **Stays per-tenant by construction.** PPR runs over the org-visible subgraph; cross-tenant leakage is impossible.
- **Recognition memory pre-filter is the cheap leverage point.** Most of HippoRAG 2's gain comes from filtering bad seeds before PPR amplifies them. One LLM call upgrades retrieval substantially.
- **Doesn't preempt Neo4j projection.** PPR is for relevance ranking; Neo4j is for transitive traversal queries ("everything that transitively cites paper X"). They serve different needs and can both be added.

---

## 4. Risks

- **PPR cost grows with subgraph size.** For tenants > 10k pages, full PPR per query is too slow. Mitigations: (a) Monte Carlo PPR with `k = 1000` random walks (constant time per query), (b) pre-compute top-N PPR neighbors for hot pages and cache, (c) fall back to vector-only when subgraph exceeds threshold.
- **Recognition memory adds an LLM call per query.** ~200–500ms latency. Worth it only when results are visibly better; behind a flag so A/B comparison is possible.
- **Subgraph cache invalidation.** A wiki edit invalidates the cache; if writes are frequent, cache thrash dominates. Mitigation: incremental cache update (add/remove single node/edge in place) rather than full rebuild.
- **Recognition memory false negatives.** The LLM filter might drop a relevant page. Mitigation: keep top-3 vector hits in the seed set unconditionally, regardless of LLM filter verdict.
- **PPR over a young wiki is noise.** When the link graph is sparse (kernel-only, no org overlay yet), PPR adds little over vector. Mitigation: feature flag default off; enable per-org once overlay reaches a threshold (~50 internal links).

---

## 5. Out of Scope

- **Neo4j projection** for transitive traversal queries — separate, complementary spec.
- **Cross-tenant PPR for the kernel.** PPR over the kernel-only graph could surface common patterns across the kernel itself, useful for kernel maintainers. Different access model; defer.
- **Learned-to-rank fusion** (replacing fixed `β`) — possible later if usage data justifies it.
- **GPU-accelerated PPR.** For tenants needing it, dedicated infra spec.
