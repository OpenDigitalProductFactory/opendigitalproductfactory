import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const upsertVectors = vi.fn();
const searchSimilar = vi.fn();
const deleteVectors = vi.fn();
const scrollPoints = vi.fn();
const generateEmbedding = vi.fn();
const wikiPageFindMany = vi.fn();

vi.mock("@dpf/db", () => ({
  QDRANT_COLLECTIONS: {
    AGENT_MEMORY: "agent-memory",
    PLATFORM_KNOWLEDGE: "platform-knowledge",
    WIKI_PAGES: "wiki-pages",
  },
  upsertVectors: (...args: unknown[]) => upsertVectors(...args),
  searchSimilar: (...args: unknown[]) => searchSimilar(...args),
  deleteVectors: (...args: unknown[]) => deleteVectors(...args),
  scrollPoints: (...args: unknown[]) => scrollPoints(...args),
  prisma: { wikiPage: { findMany: (...args: unknown[]) => wikiPageFindMany(...args) } },
}));

const isEmbeddingAvailable = vi.fn(async () => true);
vi.mock("@/lib/inference/embedding", () => ({
  generateEmbedding: (...args: unknown[]) => generateEmbedding(...args),
  isEmbeddingAvailable: () => isEmbeddingAvailable(),
}));

import {
  deleteWikiPageVector,
  searchWikiPages,
  storeWikiPage,
} from "./embeddings";
import {
  reconcilePublishedWikiEmbeddings,
  reconcileWikiEmbeddingsOnBoot,
} from "./embedding-reconciliation";

const stub = (n: number) => new Array(n).fill(0).map((_, i) => i / n);

beforeEach(() => {
  wikiPageFindMany.mockResolvedValue([]);
});

afterEach(() => {
  upsertVectors.mockReset();
  searchSimilar.mockReset();
  deleteVectors.mockReset();
  scrollPoints.mockReset();
  generateEmbedding.mockReset();
  wikiPageFindMany.mockReset();
});

describe("storeWikiPage", () => {
  it("upserts a kernel page point with the documented payload shape", async () => {
    generateEmbedding.mockResolvedValueOnce(stub(768));

    const ok = await storeWikiPage({
      pageId: "wp_kernel_1",
      slug: "entities/digital-product",
      title: "Digital Product",
      body: "A digital product is...".repeat(20),
      abstract: "One-paragraph abstract.",
      pageKind: "entity",
      status: "published",
      isKernel: true,
      kernelVersion: "0.1.0",
      organizationId: null,
      kernelPageId: null,
    });

    expect(ok).toBe(true);
    expect(generateEmbedding).toHaveBeenCalledTimes(1);
    expect(upsertVectors).toHaveBeenCalledWith(
      "wiki-pages",
      [
        expect.objectContaining({
          id: "wiki-page-wp_kernel_1",
          payload: expect.objectContaining({
            entityType: "wiki-page",
            entityId: "wp_kernel_1",
            slug: "entities/digital-product",
            title: "Digital Product",
            pageKind: "entity",
            status: "published",
            isKernel: true,
            organizationId: null,
            kernelVersion: "0.1.0",
            kernelPageId: null,
          }),
        }),
      ],
    );
  });

  it("includes canonical principle metadata in the payload when pageKind is principle", async () => {
    generateEmbedding.mockResolvedValueOnce(stub(768));

    await storeWikiPage({
      pageId: "wp_principle_1",
      slug: "principles/architecture-over-shortcuts",
      title: "Architecture Over Shortcuts",
      body: "## Rule\n\nPrefer long-term maintainability.",
      abstract: "One-line direction.",
      pageKind: "principle",
      status: "published",
      isKernel: true,
      kernelVersion: "0.2.0",
      organizationId: null,
      kernelPageId: null,
      principleTier: "commandment",
      principleAppliesTo: [
        "in_platform_coworker",
        "external_coding_agent",
      ],
      principleDimensions: [
        "long_term_maintainability",
        "schema_grounding",
        "speed_to_value",
      ],
      principlePublic: true,
    });

    expect(upsertVectors).toHaveBeenCalledWith(
      "wiki-pages",
      [
        expect.objectContaining({
          payload: expect.objectContaining({
            pageKind: "principle",
            principleTier: "commandment",
            principleAppliesTo: [
              "in_platform_coworker",
              "external_coding_agent",
            ],
            principleDimensions: [
              "long_term_maintainability",
              "schema_grounding",
              "speed_to_value",
            ],
            principlePublic: true,
          }),
        }),
      ],
    );
  });

  it("does NOT include principle keys when pageKind is not principle (absence is the marker)", async () => {
    generateEmbedding.mockResolvedValueOnce(stub(768));

    await storeWikiPage({
      pageId: "wp_entity_1",
      slug: "entities/edge-node",
      title: "Edge Node",
      body: "An edge node is the customer-owned compute appliance...",
      abstract: null,
      pageKind: "entity",
      status: "published",
      isKernel: true,
      kernelVersion: "0.2.0",
      organizationId: null,
      kernelPageId: null,
    });

    const call = upsertVectors.mock.calls[0] as unknown as [
      string,
      Array<{ payload: Record<string, unknown> }>,
    ];
    const payload = call[1][0].payload;
    expect(payload).not.toHaveProperty("principleTier");
    expect(payload).not.toHaveProperty("principleAppliesTo");
    expect(payload).not.toHaveProperty("principleDimensions");
    expect(payload).not.toHaveProperty("principlePublic");
  });

  it("does NOT include principle keys when pageKind is principle but caller omitted them (incomplete drafts)", async () => {
    generateEmbedding.mockResolvedValueOnce(stub(768));

    await storeWikiPage({
      pageId: "wp_principle_draft",
      slug: "principles/draft",
      title: "Draft",
      body: "TBD",
      abstract: null,
      pageKind: "principle",
      status: "draft",
      isKernel: true,
      kernelVersion: null,
      organizationId: null,
      kernelPageId: null,
    });

    const call = upsertVectors.mock.calls[0] as unknown as [
      string,
      Array<{ payload: Record<string, unknown> }>,
    ];
    const payload = call[1][0].payload;
    expect(payload.pageKind).toBe("principle");
    expect(payload).not.toHaveProperty("principleTier");
    expect(payload).not.toHaveProperty("principleAppliesTo");
    expect(payload).not.toHaveProperty("principleDimensions");
    expect(payload).not.toHaveProperty("principlePublic");
  });

  it("retries once when an idle-evicted embedding provider loads on demand", async () => {
    generateEmbedding.mockResolvedValueOnce(null).mockResolvedValueOnce(stub(768));

    const ok = await storeWikiPage({
      pageId: "wp_1",
      slug: "entities/test",
      title: "T",
      body: "body",
      abstract: null,
      pageKind: "entity",
      status: "published",
      isKernel: true,
      kernelVersion: null,
      organizationId: null,
      kernelPageId: null,
    });

    expect(ok).toBe(true);
    expect(generateEmbedding).toHaveBeenCalledTimes(2);
    expect(upsertVectors).toHaveBeenCalledTimes(1);
  });

  it("retains fail-safe behavior when the embedding provider is genuinely unavailable", async () => {
    generateEmbedding.mockResolvedValue(null);
    const ok = await storeWikiPage({
      pageId: "wp_outage", slug: "entities/outage", title: "Outage", body: "body",
      abstract: null, pageKind: "entity", status: "published", isKernel: true,
      kernelVersion: null, organizationId: null, kernelPageId: null,
    });
    expect(ok).toBe(false);
    expect(generateEmbedding).toHaveBeenCalledTimes(2);
    expect(upsertVectors).not.toHaveBeenCalled();
  });

  it("truncates embedding input to 8000 chars", async () => {
    generateEmbedding.mockResolvedValueOnce(stub(768));
    const longBody = "x".repeat(20_000);

    await storeWikiPage({
      pageId: "wp_long",
      slug: "entities/long",
      title: "Long",
      body: longBody,
      abstract: "abstract",
      pageKind: "entity",
      status: "published",
      isKernel: true,
      kernelVersion: null,
      organizationId: null,
      kernelPageId: null,
    });

    const callArg = generateEmbedding.mock.calls[0][0] as string;
    expect(callArg.length).toBeLessThanOrEqual(8000);
  });
});

describe("published wiki embedding reconciliation", () => {
  it("idempotently backfills only published pages whose vector is missing", async () => {
    scrollPoints.mockResolvedValue([{ id: 1, payload: { entityId: "wp-present" } }]);
    wikiPageFindMany.mockResolvedValue([
      {
        id: "wp-present", slug: "entities/present", title: "Present", body: "body",
        abstract: null, pageKind: "entity", status: "published", isKernel: true,
        kernelVersion: null, organizationId: null, kernelPageId: null,
        principleTier: null, principleAppliesTo: [], principleRingScope: [],
        principleDimensionVector: null, principlePublic: null,
      },
      {
        id: "wp-missing", slug: "entities/missing", title: "Missing", body: "body",
        abstract: null, pageKind: "entity", status: "published", isKernel: true,
        kernelVersion: null, organizationId: null, kernelPageId: null,
        principleTier: null, principleAppliesTo: [], principleRingScope: [],
        principleDimensionVector: null, principlePublic: null,
      },
    ]);
    generateEmbedding.mockResolvedValue(stub(768));

    const result = await reconcilePublishedWikiEmbeddings();
    expect(result).toEqual({ scanned: 2, missing: 1, embedded: 1, failed: [] });
    expect(upsertVectors).toHaveBeenCalledTimes(1);
    expect(upsertVectors.mock.calls[0]?.[1]?.[0]?.id).toBe("wiki-page-wp-missing");
  });

  it("leaves a skipped page eligible for the next governed run", async () => {
    scrollPoints.mockResolvedValue([]);
    wikiPageFindMany.mockResolvedValue([{
      id: "wp-retry", slug: "entities/retry", title: "Retry", body: "body",
      abstract: null, pageKind: "entity", status: "published", isKernel: true,
      kernelVersion: null, organizationId: null, kernelPageId: null,
      principleTier: null, principleAppliesTo: [], principleRingScope: [],
      principleDimensionVector: null, principlePublic: null,
    }]);
    generateEmbedding.mockResolvedValue(null);
    expect(await reconcilePublishedWikiEmbeddings()).toMatchObject({ embedded: 0, failed: ["entities/retry"] });
    generateEmbedding.mockReset().mockResolvedValue(stub(768));
    expect(await reconcilePublishedWikiEmbeddings()).toMatchObject({ embedded: 1, failed: [] });
  });
});

describe("searchWikiPages: principle filters", () => {
  function makeQdrantResult(payload: Record<string, unknown>, score = 0.8) {
    return { id: 1, score, payload };
  }

  it("translates principleTier filter into a Qdrant payload-key match clause", async () => {
    generateEmbedding.mockResolvedValueOnce(stub(768));
    searchSimilar.mockResolvedValueOnce([]);

    await searchWikiPages({
      query: "evidence over inference",
      organizationId: null,
      pageKind: "principle",
      principleTier: "commandment",
    });

    const filter = searchSimilar.mock.calls[0][2] as Record<string, unknown>;
    expect(filter).toMatchObject({
      must: expect.arrayContaining([
        { key: "principleTier", match: { value: "commandment" } },
      ]),
    });
  });

  it("translates principleAppliesTo filter into an array-containment match clause", async () => {
    generateEmbedding.mockResolvedValueOnce(stub(768));
    searchSimilar.mockResolvedValueOnce([]);

    await searchWikiPages({
      query: "long-term maintainability",
      organizationId: null,
      pageKind: "principle",
      principleAppliesTo: "external_coding_agent",
    });

    const filter = searchSimilar.mock.calls[0][2] as Record<string, unknown>;
    expect(filter).toMatchObject({
      must: expect.arrayContaining([
        {
          key: "principleAppliesTo",
          match: { value: "external_coding_agent" },
        },
      ]),
    });
  });

  it("translates principlePublic=true filter into a boolean match clause", async () => {
    generateEmbedding.mockResolvedValueOnce(stub(768));
    searchSimilar.mockResolvedValueOnce([]);

    await searchWikiPages({
      query: "principles",
      organizationId: null,
      pageKind: "principle",
      principlePublic: true,
    });

    const filter = searchSimilar.mock.calls[0][2] as Record<string, unknown>;
    expect(filter).toMatchObject({
      must: expect.arrayContaining([
        { key: "principlePublic", match: { value: true } },
      ]),
    });
  });

  it("combines all three principle filters when supplied together", async () => {
    generateEmbedding.mockResolvedValueOnce(stub(768));
    searchSimilar.mockResolvedValueOnce([]);

    await searchWikiPages({
      query: "commandments for external agents",
      organizationId: null,
      pageKind: "principle",
      principleTier: "commandment",
      principleAppliesTo: "external_coding_agent",
      principlePublic: true,
    });

    const filter = searchSimilar.mock.calls[0][2] as Record<string, unknown>;
    const must = filter.must as Array<Record<string, unknown>>;
    const keys = must.map((c) => c.key);
    expect(keys).toContain("principleTier");
    expect(keys).toContain("principleAppliesTo");
    expect(keys).toContain("principlePublic");
  });

  it("omits principle filter clauses when none are supplied (backwards compat)", async () => {
    generateEmbedding.mockResolvedValueOnce(stub(768));
    searchSimilar.mockResolvedValueOnce([]);

    await searchWikiPages({
      query: "any wiki page",
      organizationId: null,
    });

    const filter = searchSimilar.mock.calls[0][2] as Record<string, unknown>;
    const must = filter.must as Array<Record<string, unknown>>;
    const keys = must.map((c) => c.key);
    expect(keys).not.toContain("principleTier");
    expect(keys).not.toContain("principleAppliesTo");
    expect(keys).not.toContain("principlePublic");
  });
});

describe("deleteWikiPageVector", () => {
  it("removes the point by entityId filter", async () => {
    await deleteWikiPageVector("wp_kernel_1");
    expect(deleteVectors).toHaveBeenCalledWith("wiki-pages", {
      must: [{ key: "entityId", match: { value: "wp_kernel_1" } }],
    });
  });
});

describe("searchWikiPages: two-pass overlay-aware retrieval", () => {
  function makeQdrantResult(payload: Record<string, unknown>, score = 0.8) {
    return { id: 1, score, payload };
  }

  it("kernel-only when organizationId is null (no pass A)", async () => {
    generateEmbedding.mockResolvedValueOnce(stub(768));
    searchSimilar.mockResolvedValueOnce([
      makeQdrantResult({
        entityId: "wp_kernel_1",
        slug: "entities/digital-product",
        title: "Digital Product",
        pageKind: "entity",
        contentPreview: "A digital product is...",
        isKernel: true,
        organizationId: null,
        kernelPageId: null,
      }),
    ]);

    const results = await searchWikiPages({ query: "what is a digital product?", organizationId: null });

    expect(searchSimilar).toHaveBeenCalledTimes(1);
    const kernelCallFilter = searchSimilar.mock.calls[0][2] as Record<string, unknown>;
    expect(kernelCallFilter).toMatchObject({
      must: expect.arrayContaining([
        { key: "isKernel", match: { value: true } },
      ]),
    });
    expect(results).toHaveLength(1);
    expect(results[0].source).toBe("kernel");
  });

  it("org-scoped pass A first, then kernel fallback", async () => {
    generateEmbedding.mockResolvedValueOnce(stub(768));
    // Pass A: one org match
    searchSimilar.mockResolvedValueOnce([
      makeQdrantResult({
        entityId: "wp_overlay_1",
        slug: "entities/digital-product",
        title: "Digital Product (Acme)",
        pageKind: "entity",
        contentPreview: "Acme's view...",
        isKernel: false,
        organizationId: "org_acme",
        kernelPageId: "wp_kernel_dp",
      }, 0.9),
    ]);
    // Pass B: two kernel matches (one of them is the masked one — must be excluded by filter)
    searchSimilar.mockResolvedValueOnce([
      makeQdrantResult({
        entityId: "wp_kernel_portfolio",
        slug: "entities/portfolio",
        title: "Portfolio",
        pageKind: "entity",
        contentPreview: "A portfolio is...",
        isKernel: true,
        organizationId: null,
        kernelPageId: null,
      }, 0.75),
    ]);

    const results = await searchWikiPages({
      query: "what is a digital product?",
      organizationId: "org_acme",
      limit: 5,
    });

    expect(searchSimilar).toHaveBeenCalledTimes(2);

    // Pass A filter constrains by organizationId
    const passAFilter = searchSimilar.mock.calls[0][2] as { must: Array<Record<string, unknown>> };
    expect(passAFilter.must).toEqual(
      expect.arrayContaining([{ key: "organizationId", match: { value: "org_acme" } }]),
    );

    // Pass B excludes the kernel page that pass A already masked
    const passBFilter = searchSimilar.mock.calls[1][2] as {
      must: Array<Record<string, unknown>>;
      must_not?: Array<Record<string, unknown>>;
    };
    expect(passBFilter.must).toEqual(
      expect.arrayContaining([{ key: "isKernel", match: { value: true } }]),
    );
    expect(passBFilter.must_not).toEqual([
      { key: "entityId", match: { any: ["wp_kernel_dp"] } },
    ]);

    expect(results.map((r) => r.source)).toEqual(["org", "kernel"]);
    expect(results.map((r) => r.pageId)).toEqual(["wp_overlay_1", "wp_kernel_portfolio"]);
  });

  it("does not call kernel pass when org results already fill the limit", async () => {
    generateEmbedding.mockResolvedValueOnce(stub(768));
    searchSimilar.mockResolvedValueOnce([
      makeQdrantResult({ entityId: "a", slug: "x/a", title: "A", pageKind: "entity", contentPreview: "", isKernel: false, organizationId: "o", kernelPageId: null }, 0.9),
      makeQdrantResult({ entityId: "b", slug: "x/b", title: "B", pageKind: "entity", contentPreview: "", isKernel: false, organizationId: "o", kernelPageId: null }, 0.8),
    ]);

    const results = await searchWikiPages({
      query: "q",
      organizationId: "o",
      limit: 2,
    });

    expect(searchSimilar).toHaveBeenCalledTimes(1);
    expect(results).toHaveLength(2);
    expect(results.every((r) => r.source === "org")).toBe(true);
  });

  it("falls back to overlay-aware lexical doctrine retrieval when embedding generation fails", async () => {
    generateEmbedding.mockResolvedValueOnce(null);
    wikiPageFindMany.mockResolvedValueOnce([{
      id: "wp-universal-work",
      slug: "principles/universal-work-formula",
      title: "Universal Work Formula",
      body: "All work runs one invariant formula.",
      abstract: "Vary context, temporal shape, and participants only.",
      pageKind: "principle",
      isKernel: true,
      organizationId: null,
      kernelPageId: null,
      principleTier: "core",
      principleAppliesTo: ["external_coding_agent"],
      principleRingScope: [],
      principleDimensions: ["architecture_alignment"],
      principlePublic: true,
    }]);
    const results = await searchWikiPages({
      query: "Universal Work Formula",
      organizationId: null,
      pageKind: "principle",
    });
    expect(results).toEqual([expect.objectContaining({
      pageId: "wp-universal-work",
      slug: "principles/universal-work-formula",
      source: "kernel",
    })]);
    expect(searchSimilar).not.toHaveBeenCalled();
  });

  it("falls back to Postgres when semantic search misses an existing published page", async () => {
    generateEmbedding.mockResolvedValueOnce(stub(768));
    searchSimilar.mockResolvedValueOnce([]);
    wikiPageFindMany.mockResolvedValueOnce([{
      id: "wp-universal-work",
      slug: "principles/universal-work-formula",
      title: "Universal Work Formula",
      body: "All work runs one invariant formula.",
      abstract: "Vary context, temporal shape, and participants only.",
      pageKind: "principle",
      isKernel: true,
      organizationId: null,
      kernelPageId: null,
      principleTier: "core",
      principleAppliesTo: ["external_coding_agent"],
      principleRingScope: [],
      principleDimensions: ["architecture_alignment"],
      principlePublic: true,
    }]);

    const results = await searchWikiPages({
      query: "Universal Work Formula",
      organizationId: null,
      pageKind: "principle",
      principleAppliesTo: "external_coding_agent",
    });

    expect(searchSimilar).toHaveBeenCalledTimes(1);
    expect(wikiPageFindMany).toHaveBeenCalledTimes(1);
    expect(results).toEqual([expect.objectContaining({
      pageId: "wp-universal-work",
      slug: "principles/universal-work-formula",
      source: "kernel",
    })]);
  });

  it("includes pageKind filter when provided", async () => {
    generateEmbedding.mockResolvedValueOnce(stub(768));
    searchSimilar.mockResolvedValueOnce([]);
    await searchWikiPages({ query: "q", organizationId: null, pageKind: "stance" });
    const filter = searchSimilar.mock.calls[0][2] as { must: Array<Record<string, unknown>> };
    expect(filter.must).toEqual(
      expect.arrayContaining([{ key: "pageKind", match: { value: "stance" } }]),
    );
  });
});

// BI-ED117C82 — the reconcile described itself as "wired into portal boot" since
// BI-D4C1E05E but had no caller outside the maintainer script, so a partially
// embedded corpus stayed partial. A live install was found with a published org
// stance carrying no vector on a portal booted long after it was authored.
describe("wiki embedding boot self-heal (BI-ED117C82)", () => {
  const page = {
    id: "wp-1", slug: "stances/how-we-decide", title: "How we decide", body: "body",
    abstract: null, pageKind: "stance", status: "published", isKernel: false,
    kernelVersion: null, organizationId: "org-1", kernelPageId: null,
    principleTier: null, principleAppliesTo: [], principleRingScope: [],
    principleDimensionVector: null, principlePublic: null,
  };

  beforeEach(() => {
    isEmbeddingAvailable.mockReset().mockResolvedValue(true);
  });

  it("reports a provider outage instead of a clean pass", async () => {
    scrollPoints.mockResolvedValue([]);
    wikiPageFindMany.mockResolvedValue([page]);
    isEmbeddingAvailable.mockResolvedValue(false);

    const result = await reconcilePublishedWikiEmbeddings();

    // The regression: this used to return embedded:0 / failed:[] — identical to
    // "nothing needed doing" — so a total no-op looked like a healthy corpus.
    expect(result.providerUnavailable).toBe(true);
    expect(result.missing).toBe(1);
    expect(result.failed).toEqual(["stances/how-we-decide"]);
    expect(upsertVectors).not.toHaveBeenCalled();
  });

  it("does not claim an outage when nothing is missing", async () => {
    scrollPoints.mockResolvedValue([{ payload: { entityId: "wp-1" } }]);
    wikiPageFindMany.mockResolvedValue([page]);
    isEmbeddingAvailable.mockResolvedValue(false);

    const result = await reconcilePublishedWikiEmbeddings();
    expect(result.providerUnavailable).toBeUndefined();
    expect(result.missing).toBe(0);
  });

  it("warns with a coverage NUMBER and names the outage on the boot path", async () => {
    scrollPoints.mockResolvedValue([]);
    wikiPageFindMany.mockResolvedValue([page]);
    isEmbeddingAvailable.mockResolvedValue(false);
    const logger = { log: vi.fn(), warn: vi.fn(), error: vi.fn() };

    await reconcileWikiEmbeddingsOnBoot(logger);

    expect(logger.warn).toHaveBeenCalledTimes(1);
    const message = logger.warn.mock.calls[0]![0] as string;
    expect(message).toContain("0/1");
    expect(message).toContain("not a clean pass");
    expect(logger.log).not.toHaveBeenCalled();
  });

  it("logs coverage on a healthy run", async () => {
    scrollPoints.mockResolvedValue([]);
    wikiPageFindMany.mockResolvedValue([page]);
    generateEmbedding.mockResolvedValue(stub(768));
    const logger = { log: vi.fn(), warn: vi.fn(), error: vi.fn() };

    await reconcileWikiEmbeddingsOnBoot(logger);

    expect(logger.warn).not.toHaveBeenCalled();
    expect(logger.log.mock.calls[0]![0]).toContain("1/1");
  });

  it("never throws out of the boot hook", async () => {
    wikiPageFindMany.mockRejectedValue(new Error("db down"));
    const logger = { log: vi.fn(), warn: vi.fn(), error: vi.fn() };

    await expect(reconcileWikiEmbeddingsOnBoot(logger)).resolves.toBeNull();
    expect(logger.error).toHaveBeenCalled();
  });
});
