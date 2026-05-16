// EP-WIKI-004: Personalized PageRank retrieval over the wiki-link graph.
// Spec: docs/superpowers/specs/2026-05-09-wiki-ppr-retrieval-design.md
//
// Layers on top of the existing vector search (EP-WIKI-001 §11) — does not
// replace it. The flow is:
//
//   1. Vector seed phase — `searchWikiPages({ query, organizationId, limit })`
//      returns top-K candidates by cosine similarity.
//   2. PPR computation — run Personalized PageRank over the per-org
//      WikiPage / WikiPageLink subgraph, with reset probabilities weighted
//      by the cosine scores of the seed set.
//   3. Combine — final score = β × PPR + (1 − β) × cosine. Default
//      β = 0.6 (favour PPR but keep cosine grounding).
//
// PPR is implemented in-process via power iteration over a sparse adjacency
// list. No graph DB, no extra dependency. For small wikis (≤ 1k pages) the
// per-query subgraph load is a few ms; spec section 4 covers Monte Carlo
// fallback and per-tenant cache once the wiki grows past ~10k pages.
//
// Recognition-memory pre-filter (one LLM call to drop irrelevant seeds
// before PPR amplifies them) and dual-level keyword decomposition (spec
// sections 2.2 step 2 + 2.4) are intentionally out of scope for this first
// slice — both add LLM cost and need an A/B baseline to justify. They sit
// behind future sub-flags once the algorithm proves value over plain vector.

import {
  searchWikiPages,
  type WikiSearchResult,
} from "./embeddings";

// ─── Types ──────────────────────────────────────────────────────────────────

/** Subgraph snapshot — every visible WikiPage + every WikiPageLink whose endpoints are both visible. */
export type WikiSubgraph = {
  /** Page ids in the subgraph. Ordered for stable iteration. */
  nodes: string[];
  /** `outNeighbors[pageId]` is the list of page ids reachable in one hop. */
  outNeighbors: Map<string, string[]>;
  /** Slug + kind + isKernel lookup so the result formatter has metadata without re-querying. */
  meta: Map<string, WikiPageMeta>;
};

export type WikiPageMeta = {
  slug: string;
  pageKind: string;
  title: string;
  isKernel: boolean;
  abstract: string | null;
};

export type PPRSearchInput = {
  query: string;
  organizationId: string | null;
  /** Max number of vector seeds taken into the PPR phase. Default 20. */
  seedLimit?: number;
  /** Final result count returned to the caller. Default 5. */
  limit?: number;
  /** Random-restart probability. Default 0.15 (HippoRAG-conventional). */
  alpha?: number;
  /** Number of power iterations. Default 20; converges well before this. */
  iterations?: number;
  /** Blend factor: final = β × PPR + (1 − β) × cosine. Default 0.6. */
  beta?: number;
};

export type PPRSearchResult = WikiSearchResult & {
  /** Cosine score from the seed phase (0 when not a seed). */
  cosineScore: number;
  /** PPR mass after iteration (always > 0). */
  pprScore: number;
  /** Final combined score used for the result ordering. */
  combinedScore: number;
};

/** Minimal Prisma surface — keeps unit tests easy to mock. */
export type SubgraphDbClient = {
  wikiPage: {
    findMany: (args: {
      where?: Record<string, unknown>;
      select?: Record<string, unknown>;
    }) => Promise<unknown>;
  };
  wikiPageLink: {
    findMany: (args: {
      where?: Record<string, unknown>;
      select?: Record<string, unknown>;
    }) => Promise<unknown>;
  };
};

// ─── Subgraph loader ────────────────────────────────────────────────────────

/**
 * Build the per-tenant subgraph. Includes:
 *   - every published WikiPage scoped to (orgId OR kernel)
 *   - every WikiPageLink whose `from` AND `to` are in that page set
 *
 * Per spec §2.1, "Nodes: WikiPage rows visible to the requesting org
 * (kernel + overlay; standard EP-WIKI-001 visibility); Edges: WikiPageLink
 * rows where both endpoints are visible." Cross-tenant leakage is
 * impossible because the page filter is applied before the link filter.
 *
 * Overlay masking: when an org overlay row shares a slug with a kernel
 * row, both nodes are present in the subgraph (different page ids).
 * The viewer / retrieval layer dedupes by slug at presentation time;
 * for PPR purposes both versions contribute to the walk, which is the
 * right behaviour — links into the kernel page also imply relevance to
 * the overlay version.
 */
export async function loadOverlaySubgraph(
  db: SubgraphDbClient,
  organizationId: string | null,
): Promise<WikiSubgraph> {
  const pageWhere: Record<string, unknown> = { status: "published" };
  if (organizationId === null) {
    pageWhere.organizationId = null;
  } else {
    pageWhere.OR = [{ organizationId }, { organizationId: null }];
  }

  const pages = (await db.wikiPage.findMany({
    where: pageWhere,
    select: {
      id: true,
      slug: true,
      title: true,
      pageKind: true,
      isKernel: true,
      abstract: true,
    },
  })) as Array<{
    id: string;
    slug: string;
    title: string;
    pageKind: string;
    isKernel: boolean;
    abstract: string | null;
  }>;

  const nodeIds = pages.map((p) => p.id);
  const visible = new Set(nodeIds);
  const meta = new Map<string, WikiPageMeta>();
  for (const p of pages) {
    meta.set(p.id, {
      slug: p.slug,
      title: p.title,
      pageKind: p.pageKind,
      isKernel: p.isKernel,
      abstract: p.abstract,
    });
  }

  const links = (await db.wikiPageLink.findMany({
    where: {
      fromPageId: { in: nodeIds },
      toPageId: { in: nodeIds },
    },
    select: { fromPageId: true, toPageId: true },
  })) as Array<{ fromPageId: string; toPageId: string }>;

  const outNeighbors = new Map<string, string[]>();
  for (const nodeId of nodeIds) outNeighbors.set(nodeId, []);
  for (const edge of links) {
    if (!visible.has(edge.fromPageId) || !visible.has(edge.toPageId)) {
      continue;
    }
    const adj = outNeighbors.get(edge.fromPageId);
    if (adj) adj.push(edge.toPageId);
  }

  return { nodes: nodeIds, outNeighbors, meta };
}

// ─── PPR algorithm ──────────────────────────────────────────────────────────

/**
 * Pure power-iteration PPR. No randomness; deterministic given the seeds.
 *
 * Math (per HippoRAG 2):
 *   rank_{t+1}[v] = α × seedMass[v] + (1 − α) × Σ_{u → v} (rank_t[u] / outDegree(u))
 *
 * Dangling nodes (no outbound edges) get their mass redistributed
 * uniformly across all nodes — the standard PageRank correction;
 * without it, mass leaks and the rank vector drifts.
 *
 * Convergence: 20 iterations is typically more than enough for small
 * graphs (< 1k nodes). The L1 delta check exits early.
 */
export function personalizedPageRank(args: {
  subgraph: WikiSubgraph;
  /** Reset mass distribution — entries must sum to 1.0 (we normalise). */
  seeds: Map<string, number>;
  alpha?: number;
  iterations?: number;
  /** Early-exit threshold on the L1 delta between iterations. Default 1e-6. */
  tolerance?: number;
}): Map<string, number> {
  const { subgraph } = args;
  const alpha = args.alpha ?? 0.15;
  const maxIter = args.iterations ?? 20;
  const tolerance = args.tolerance ?? 1e-6;

  const nodes = subgraph.nodes;
  const n = nodes.length;
  if (n === 0) return new Map();

  // Normalise the seed distribution; nodes outside the seed set get 0.
  let seedTotal = 0;
  for (const w of args.seeds.values()) seedTotal += w;
  const seedMass = new Map<string, number>();
  if (seedTotal > 0) {
    for (const [node, w] of args.seeds) {
      seedMass.set(node, w / seedTotal);
    }
  } else {
    // No seeds → uniform restart distribution. PPR with uniform restart
    // degenerates to plain PageRank; matches the spec's "stays per-tenant
    // by construction" guarantee even on an empty seed set.
    for (const node of nodes) seedMass.set(node, 1 / n);
  }

  // Initialise rank vector to the seed mass.
  let rank = new Map<string, number>();
  for (const node of nodes) rank.set(node, seedMass.get(node) ?? 0);

  // Precompute out-degree for each node.
  const outDegree = new Map<string, number>();
  for (const node of nodes) {
    outDegree.set(node, subgraph.outNeighbors.get(node)?.length ?? 0);
  }

  for (let iter = 0; iter < maxIter; iter++) {
    const next = new Map<string, number>();
    for (const node of nodes) next.set(node, alpha * (seedMass.get(node) ?? 0));

    // Sum mass from dangling nodes (no outbound edges) — redistribute
    // uniformly so total mass is conserved.
    let danglingMass = 0;
    for (const node of nodes) {
      const deg = outDegree.get(node) ?? 0;
      if (deg === 0) {
        danglingMass += rank.get(node) ?? 0;
      }
    }
    const danglingShare = (1 - alpha) * (danglingMass / n);
    if (danglingShare > 0) {
      for (const node of nodes) {
        next.set(node, (next.get(node) ?? 0) + danglingShare);
      }
    }

    // Push mass along each edge.
    for (const node of nodes) {
      const deg = outDegree.get(node) ?? 0;
      if (deg === 0) continue;
      const share = ((1 - alpha) * (rank.get(node) ?? 0)) / deg;
      const adj = subgraph.outNeighbors.get(node);
      if (!adj) continue;
      for (const dest of adj) {
        next.set(dest, (next.get(dest) ?? 0) + share);
      }
    }

    // L1 delta check for early exit.
    let delta = 0;
    for (const node of nodes) {
      delta += Math.abs((next.get(node) ?? 0) - (rank.get(node) ?? 0));
    }
    rank = next;
    if (delta < tolerance) break;
  }

  return rank;
}

// ─── End-to-end search ──────────────────────────────────────────────────────

/**
 * Vector → PPR → combine. Returns top-N pages ranked by the combined
 * score, with cosine + PPR + combined scores attached so the reviewer
 * can audit the ranking.
 *
 * Falls back to vector-only when the subgraph has 0 edges (PPR adds no
 * signal over the seed cosine in that case). Also falls back when the
 * seed set is empty (e.g. vector search returned nothing for the query).
 *
 * Per spec §2.1, seed reset probabilities are weighted by cosine scores.
 * We normalise inside `personalizedPageRank`, so callers can hand us raw
 * scores or pre-normalised weights — same result.
 */
export async function searchByPPR(
  input: PPRSearchInput & { db: SubgraphDbClient },
): Promise<PPRSearchResult[]> {
  const seedLimit = input.seedLimit ?? 20;
  const limit = input.limit ?? 5;
  const beta = input.beta ?? 0.6;

  const seeds = await searchWikiPages({
    query: input.query,
    organizationId: input.organizationId,
    limit: seedLimit,
  });
  if (seeds.length === 0) return [];

  const subgraph = await loadOverlaySubgraph(input.db, input.organizationId);

  // Build the seed map keyed by page id (cosine score as the reset weight).
  // Seeds that don't appear in the subgraph (e.g. status changed since
  // Qdrant indexed) are dropped — PPR can't seed an absent node.
  const seedMap = new Map<string, number>();
  for (const s of seeds) {
    if (subgraph.meta.has(s.pageId)) {
      seedMap.set(s.pageId, s.score);
    }
  }
  if (seedMap.size === 0) return [];

  // Fast-fallback: when the subgraph has no edges, PPR collapses to seed
  // mass anyway. Return the vector seeds unchanged (cheaper, identical
  // ranking, and skips a power-iteration loop that wouldn't move anything).
  let totalEdges = 0;
  for (const adj of subgraph.outNeighbors.values()) totalEdges += adj.length;
  if (totalEdges === 0) {
    return seeds.slice(0, limit).map((s) => ({
      ...s,
      cosineScore: s.score,
      pprScore: 0,
      combinedScore: s.score,
    }));
  }

  const rank = personalizedPageRank({
    subgraph,
    seeds: seedMap,
    alpha: input.alpha,
    iterations: input.iterations,
  });

  // Find the max raw scores in each axis so we can min-max-normalise
  // before combining. Without normalisation PPR (tiny fractional masses)
  // and cosine (typically 0.4–0.95) live on different scales and β is
  // meaningless.
  let maxPpr = 0;
  for (const v of rank.values()) if (v > maxPpr) maxPpr = v;
  const seedById = new Map<string, WikiSearchResult>();
  for (const s of seeds) seedById.set(s.pageId, s);

  type Scored = { id: string; cosineScore: number; pprScore: number; combinedScore: number };
  const scored: Scored[] = [];
  for (const [id, ppr] of rank) {
    const cosine = seedById.get(id)?.score ?? 0;
    if (ppr === 0 && cosine === 0) continue;
    const pprNorm = maxPpr > 0 ? ppr / maxPpr : 0;
    const combinedScore = beta * pprNorm + (1 - beta) * cosine;
    scored.push({ id, cosineScore: cosine, pprScore: ppr, combinedScore });
  }

  scored.sort((a, b) => b.combinedScore - a.combinedScore);

  const top = scored.slice(0, limit);
  const results: PPRSearchResult[] = [];
  for (const s of top) {
    const m = subgraph.meta.get(s.id);
    if (!m) continue;
    // Reuse the seed metadata when available (it has contentPreview from
    // the Qdrant payload); fall back to the subgraph metadata otherwise.
    const seed = seedById.get(s.id);
    if (seed) {
      results.push({
        ...seed,
        score: s.combinedScore,
        cosineScore: s.cosineScore,
        pprScore: s.pprScore,
        combinedScore: s.combinedScore,
      });
    } else {
      results.push({
        pageId: s.id,
        slug: m.slug,
        title: m.title,
        pageKind: m.pageKind,
        contentPreview: m.abstract ?? "",
        isKernel: m.isKernel,
        organizationId: input.organizationId,
        kernelPageId: null,
        score: s.combinedScore,
        source: m.isKernel ? "kernel" : "org",
        cosineScore: s.cosineScore,
        pprScore: s.pprScore,
        combinedScore: s.combinedScore,
      });
    }
  }
  return results;
}
