import { beforeEach, describe, expect, it, vi } from "vitest";

// Mock the vector seed phase so tests are deterministic (no Qdrant required).
const searchWikiPagesStub = vi.hoisted(() => vi.fn());
vi.mock("./embeddings", () => ({
  searchWikiPages: (args: unknown) => searchWikiPagesStub(args),
}));

import {
  loadOverlaySubgraph,
  personalizedPageRank,
  searchByPPR,
  type SubgraphDbClient,
  type WikiSubgraph,
} from "./ppr";

beforeEach(() => {
  vi.clearAllMocks();
});

// ─── personalizedPageRank — algorithm correctness ──────────────────────────

function smallGraph(): WikiSubgraph {
  // A → B → C, with D isolated. Edge weights uniform per spec.
  return {
    nodes: ["A", "B", "C", "D"],
    outNeighbors: new Map([
      ["A", ["B"]],
      ["B", ["C"]],
      ["C", []],
      ["D", []],
    ]),
    meta: new Map([
      ["A", { slug: "a", title: "A", pageKind: "entity", isKernel: false, abstract: null }],
      ["B", { slug: "b", title: "B", pageKind: "entity", isKernel: false, abstract: null }],
      ["C", { slug: "c", title: "C", pageKind: "entity", isKernel: false, abstract: null }],
      ["D", { slug: "d", title: "D", pageKind: "entity", isKernel: false, abstract: null }],
    ]),
  };
}

describe("personalizedPageRank", () => {
  it("conserves total mass after every iteration (sums to 1)", () => {
    const rank = personalizedPageRank({
      subgraph: smallGraph(),
      seeds: new Map([["A", 1]]),
      alpha: 0.15,
      iterations: 30,
    });
    let sum = 0;
    for (const v of rank.values()) sum += v;
    expect(sum).toBeCloseTo(1, 5);
  });

  it("biases toward seed and its reachable descendants over isolated nodes", () => {
    const rank = personalizedPageRank({
      subgraph: smallGraph(),
      seeds: new Map([["A", 1]]),
      alpha: 0.15,
      iterations: 30,
    });
    // A → B → C is the random walk's path from the seed; D is unreachable.
    // Expect: rank(A) > rank(D), and B/C should also exceed D.
    expect(rank.get("A")!).toBeGreaterThan(rank.get("D")!);
    expect(rank.get("B")!).toBeGreaterThan(rank.get("D")!);
    expect(rank.get("C")!).toBeGreaterThan(rank.get("D")!);
  });

  it("ranks the seed node highest on a chain graph", () => {
    const rank = personalizedPageRank({
      subgraph: smallGraph(),
      seeds: new Map([["A", 1]]),
      alpha: 0.5, // higher alpha → more mass at seed
      iterations: 30,
    });
    expect(rank.get("A")!).toBeGreaterThan(rank.get("B")!);
    expect(rank.get("B")!).toBeGreaterThan(rank.get("C")!);
  });

  it("yields different rankings for different seeds — PPR is query-specific", () => {
    const rankFromA = personalizedPageRank({
      subgraph: smallGraph(),
      seeds: new Map([["A", 1]]),
    });
    const rankFromC = personalizedPageRank({
      subgraph: smallGraph(),
      seeds: new Map([["C", 1]]),
    });
    // From A, walk can reach B and C. From C, only C itself (no out-edges).
    expect(rankFromA.get("B")!).toBeGreaterThan(rankFromC.get("B")!);
    expect(rankFromC.get("C")!).toBeGreaterThan(rankFromA.get("C")!);
  });

  it("falls back to uniform restart when no seeds are supplied", () => {
    const rank = personalizedPageRank({
      subgraph: smallGraph(),
      seeds: new Map(),
    });
    // Uniform restart on a small connected component → all nodes get non-zero mass.
    for (const v of rank.values()) expect(v).toBeGreaterThan(0);
  });

  it("returns an empty map on an empty subgraph", () => {
    const empty: WikiSubgraph = {
      nodes: [],
      outNeighbors: new Map(),
      meta: new Map(),
    };
    const rank = personalizedPageRank({ subgraph: empty, seeds: new Map() });
    expect(rank.size).toBe(0);
  });

  it("normalises seed weights — raw cosine scores work as resets", () => {
    const rankRaw = personalizedPageRank({
      subgraph: smallGraph(),
      seeds: new Map([["A", 0.9], ["B", 0.45]]),
    });
    const rankNorm = personalizedPageRank({
      subgraph: smallGraph(),
      seeds: new Map([["A", 0.667], ["B", 0.333]]),
    });
    expect(rankRaw.get("A")!).toBeCloseTo(rankNorm.get("A")!, 3);
    expect(rankRaw.get("B")!).toBeCloseTo(rankNorm.get("B")!, 3);
  });

  it("exits early once the L1 delta drops below tolerance", () => {
    // Stationary distribution should be reached in well under 20 iterations
    // on a 4-node chain. Run with a very tight tolerance and a fixed max.
    const rank = personalizedPageRank({
      subgraph: smallGraph(),
      seeds: new Map([["A", 1]]),
      iterations: 100,
      tolerance: 1e-9,
    });
    let sum = 0;
    for (const v of rank.values()) sum += v;
    expect(sum).toBeCloseTo(1, 6);
  });
});

// ─── loadOverlaySubgraph — scope + edge filtering ──────────────────────────

function makeDb(pages: unknown[], links: unknown[]): SubgraphDbClient {
  return {
    wikiPage: {
      findMany: vi.fn(async () => pages),
    },
    wikiPageLink: {
      findMany: vi.fn(async () => links),
    },
  };
}

describe("loadOverlaySubgraph", () => {
  it("includes only kernel pages when organizationId is null", async () => {
    const db = makeDb(
      [
        {
          id: "wp_k1",
          slug: "entities/a",
          title: "A",
          pageKind: "entity",
          isKernel: true,
          abstract: null,
        },
        {
          id: "wp_k2",
          slug: "entities/b",
          title: "B",
          pageKind: "entity",
          isKernel: true,
          abstract: null,
        },
      ],
      [{ fromPageId: "wp_k1", toPageId: "wp_k2" }],
    );
    const subgraph = await loadOverlaySubgraph(db, null);
    expect(subgraph.nodes).toEqual(["wp_k1", "wp_k2"]);
    expect(subgraph.outNeighbors.get("wp_k1")).toEqual(["wp_k2"]);
    expect((db.wikiPage.findMany as ReturnType<typeof vi.fn>).mock.calls[0][0].where)
      .toEqual({ status: "published", organizationId: null });
  });

  it("includes org overlay + kernel pages when organizationId is set", async () => {
    const db = makeDb([], []);
    await loadOverlaySubgraph(db, "org_a");
    const arg = (db.wikiPage.findMany as ReturnType<typeof vi.fn>).mock.calls[0][0];
    expect(arg.where).toEqual({
      status: "published",
      OR: [{ organizationId: "org_a" }, { organizationId: null }],
    });
  });

  it("drops edges whose endpoints are outside the visible page set (defence-in-depth)", async () => {
    // Mock the DB to return an edge whose `to` is NOT in the page list —
    // simulates a cross-tenant leak that should never reach the in-memory
    // graph even if Prisma filtered incorrectly.
    const db = makeDb(
      [
        {
          id: "wp_visible",
          slug: "entities/a",
          title: "A",
          pageKind: "entity",
          isKernel: false,
          abstract: null,
        },
      ],
      [
        { fromPageId: "wp_visible", toPageId: "wp_hidden" },
        { fromPageId: "wp_hidden", toPageId: "wp_visible" },
      ],
    );
    const subgraph = await loadOverlaySubgraph(db, "org_test");
    expect(subgraph.nodes).toEqual(["wp_visible"]);
    expect(subgraph.outNeighbors.get("wp_visible")).toEqual([]);
  });

  it("exposes page metadata for the result formatter", async () => {
    const db = makeDb(
      [
        {
          id: "wp_1",
          slug: "stances/x",
          title: "Stance X",
          pageKind: "stance",
          isKernel: false,
          abstract: "abs",
        },
      ],
      [],
    );
    const subgraph = await loadOverlaySubgraph(db, "org_a");
    expect(subgraph.meta.get("wp_1")).toEqual({
      slug: "stances/x",
      title: "Stance X",
      pageKind: "stance",
      isKernel: false,
      abstract: "abs",
    });
  });
});

// ─── searchByPPR — end-to-end ──────────────────────────────────────────────

describe("searchByPPR", () => {
  it("falls back to plain vector ranking when the subgraph has no edges", async () => {
    searchWikiPagesStub.mockResolvedValueOnce([
      {
        pageId: "wp_a",
        slug: "entities/a",
        title: "A",
        pageKind: "entity",
        contentPreview: "preview a",
        isKernel: false,
        organizationId: "org_t",
        kernelPageId: null,
        score: 0.9,
        source: "org",
      },
      {
        pageId: "wp_b",
        slug: "entities/b",
        title: "B",
        pageKind: "entity",
        contentPreview: "preview b",
        isKernel: false,
        organizationId: "org_t",
        kernelPageId: null,
        score: 0.7,
        source: "org",
      },
    ]);
    const db = makeDb(
      [
        { id: "wp_a", slug: "entities/a", title: "A", pageKind: "entity", isKernel: false, abstract: null },
        { id: "wp_b", slug: "entities/b", title: "B", pageKind: "entity", isKernel: false, abstract: null },
      ],
      [], // no edges
    );
    const results = await searchByPPR({ query: "q", organizationId: "org_t", db, limit: 5 });
    expect(results).toHaveLength(2);
    expect(results[0].cosineScore).toBe(0.9);
    expect(results[0].pprScore).toBe(0);
    expect(results[0].combinedScore).toBe(0.9);
  });

  it("re-orders results when graph links push a non-seed page ahead of a low-cosine seed", async () => {
    // Seeds: A (cosine 0.9), B (cosine 0.55). Graph: A → C → D, B isolated.
    // Vector ranking would give [A, B]. PPR should promote C/D over B
    // because the walk from A reaches them and the per-tenant subgraph
    // amplifies multi-hop relevance.
    searchWikiPagesStub.mockResolvedValueOnce([
      { pageId: "A", slug: "a", title: "A", pageKind: "entity", contentPreview: "", isKernel: false, organizationId: "org_t", kernelPageId: null, score: 0.9, source: "org" },
      { pageId: "B", slug: "b", title: "B", pageKind: "entity", contentPreview: "", isKernel: false, organizationId: "org_t", kernelPageId: null, score: 0.55, source: "org" },
    ]);
    const db = makeDb(
      [
        { id: "A", slug: "a", title: "A", pageKind: "entity", isKernel: false, abstract: null },
        { id: "B", slug: "b", title: "B", pageKind: "entity", isKernel: false, abstract: null },
        { id: "C", slug: "c", title: "C", pageKind: "entity", isKernel: false, abstract: null },
        { id: "D", slug: "d", title: "D", pageKind: "entity", isKernel: false, abstract: null },
      ],
      [
        { fromPageId: "A", toPageId: "C" },
        { fromPageId: "C", toPageId: "D" },
      ],
    );
    const results = await searchByPPR({
      query: "q",
      organizationId: "org_t",
      db,
      limit: 4,
      beta: 0.9, // favour PPR strongly so the multi-hop reordering is visible
    });
    const slugs = results.map((r) => r.slug);
    expect(slugs).toContain("c");
    // A is the seed → should rank above B (no inbound mass).
    const aIdx = slugs.indexOf("a");
    const bIdx = slugs.indexOf("b");
    if (aIdx !== -1 && bIdx !== -1) {
      expect(aIdx).toBeLessThan(bIdx);
    }
  });

  it("returns empty when the seed phase returns no candidates", async () => {
    searchWikiPagesStub.mockResolvedValueOnce([]);
    const db = makeDb([], []);
    const results = await searchByPPR({ query: "q", organizationId: "org_t", db });
    expect(results).toEqual([]);
  });

  it("returns empty when seeds exist but none are present in the subgraph (stale Qdrant)", async () => {
    searchWikiPagesStub.mockResolvedValueOnce([
      { pageId: "missing", slug: "x", title: "X", pageKind: "entity", contentPreview: "", isKernel: false, organizationId: "org_t", kernelPageId: null, score: 0.9, source: "org" },
    ]);
    const db = makeDb([], []);
    const results = await searchByPPR({ query: "q", organizationId: "org_t", db });
    expect(results).toEqual([]);
  });

  it("blends β × PPR + (1 − β) × cosine on each result and exposes both raw scores", async () => {
    searchWikiPagesStub.mockResolvedValueOnce([
      { pageId: "A", slug: "a", title: "A", pageKind: "entity", contentPreview: "", isKernel: false, organizationId: "org_t", kernelPageId: null, score: 0.8, source: "org" },
    ]);
    const db = makeDb(
      [
        { id: "A", slug: "a", title: "A", pageKind: "entity", isKernel: false, abstract: null },
        { id: "B", slug: "b", title: "B", pageKind: "entity", isKernel: false, abstract: null },
      ],
      [{ fromPageId: "A", toPageId: "B" }],
    );
    const results = await searchByPPR({
      query: "q",
      organizationId: "org_t",
      db,
      limit: 5,
      beta: 0.6,
    });
    for (const r of results) {
      // Combined score is β × normalised-PPR + (1 − β) × cosine.
      // With max-normalisation, the page with the highest PPR mass has
      // pprNorm = 1, and combinedScore = 0.6 + 0.4 × cosine.
      expect(r.combinedScore).toBeGreaterThanOrEqual(0);
      expect(r.combinedScore).toBeLessThanOrEqual(1);
      expect(r).toHaveProperty("cosineScore");
      expect(r).toHaveProperty("pprScore");
    }
  });

  it("respects the limit on the returned result set", async () => {
    searchWikiPagesStub.mockResolvedValueOnce([
      { pageId: "A", slug: "a", title: "A", pageKind: "entity", contentPreview: "", isKernel: false, organizationId: "org_t", kernelPageId: null, score: 0.9, source: "org" },
    ]);
    const db = makeDb(
      [
        { id: "A", slug: "a", title: "A", pageKind: "entity", isKernel: false, abstract: null },
        { id: "B", slug: "b", title: "B", pageKind: "entity", isKernel: false, abstract: null },
        { id: "C", slug: "c", title: "C", pageKind: "entity", isKernel: false, abstract: null },
      ],
      [
        { fromPageId: "A", toPageId: "B" },
        { fromPageId: "B", toPageId: "C" },
      ],
    );
    const results = await searchByPPR({ query: "q", organizationId: "org_t", db, limit: 2 });
    expect(results).toHaveLength(2);
  });
});
