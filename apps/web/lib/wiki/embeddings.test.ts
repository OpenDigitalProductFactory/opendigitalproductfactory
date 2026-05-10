import { afterEach, describe, expect, it, vi } from "vitest";

const upsertVectors = vi.fn();
const searchSimilar = vi.fn();
const deleteVectors = vi.fn();
const generateEmbedding = vi.fn();

vi.mock("@dpf/db", () => ({
  QDRANT_COLLECTIONS: {
    AGENT_MEMORY: "agent-memory",
    PLATFORM_KNOWLEDGE: "platform-knowledge",
    WIKI_PAGES: "wiki-pages",
  },
  upsertVectors: (...args: unknown[]) => upsertVectors(...args),
  searchSimilar: (...args: unknown[]) => searchSimilar(...args),
  deleteVectors: (...args: unknown[]) => deleteVectors(...args),
}));

vi.mock("@/lib/inference/embedding", () => ({
  generateEmbedding: (...args: unknown[]) => generateEmbedding(...args),
}));

import {
  deleteWikiPageVector,
  searchWikiPages,
  storeWikiPage,
} from "./embeddings";

const stub = (n: number) => new Array(n).fill(0).map((_, i) => i / n);

afterEach(() => {
  upsertVectors.mockReset();
  searchSimilar.mockReset();
  deleteVectors.mockReset();
  generateEmbedding.mockReset();
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

  it("returns false silently when the embedding model is unavailable", async () => {
    generateEmbedding.mockResolvedValueOnce(null);

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

    expect(ok).toBe(false);
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

  it("returns empty when embedding generation fails", async () => {
    generateEmbedding.mockResolvedValueOnce(null);
    const results = await searchWikiPages({ query: "q", organizationId: null });
    expect(results).toEqual([]);
    expect(searchSimilar).not.toHaveBeenCalled();
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
