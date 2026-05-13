import { afterEach, describe, expect, it, vi } from "vitest";

const searchWikiPages = vi.fn();
const recallPrincipleContext = vi.fn();

vi.mock("./embeddings", () => ({
  searchWikiPages: (...args: unknown[]) => searchWikiPages(...args),
}));

vi.mock("./principle-recall", () => ({
  recallPrincipleContext: (...args: unknown[]) =>
    recallPrincipleContext(...args),
}));

import {
  formatWikiContext,
  recallWikiContext,
  recallWikiContextWithPrinciples,
} from "./recall";

afterEach(() => {
  searchWikiPages.mockReset();
  recallPrincipleContext.mockReset();
});

describe("formatWikiContext", () => {
  it("returns null when there are no results", () => {
    expect(formatWikiContext([])).toBeNull();
  });

  it("formats a kernel result with origin=kernel", () => {
    const out = formatWikiContext([
      {
        pageId: "wp_kernel_1",
        slug: "entities/digital-product",
        title: "Digital Product",
        pageKind: "entity",
        contentPreview: "A digital product is a software-defined service...",
        isKernel: true,
        organizationId: null,
        kernelPageId: null,
        score: 0.82,
        source: "kernel",
      },
    ]);
    expect(out).toContain("RELEVANT WIKI CONTEXT:");
    expect(out).toContain(
      "- entities/digital-product (entity, kernel) — A digital product is a software-defined service...",
    );
  });

  it("formats an overlay result with origin=overlay", () => {
    const out = formatWikiContext([
      {
        pageId: "wp_overlay_1",
        slug: "entities/digital-product",
        title: "Digital Product (Acme)",
        pageKind: "entity",
        contentPreview: "Acme treats a digital product as...",
        isKernel: false,
        organizationId: "org_acme",
        kernelPageId: "wp_kernel_dp",
        score: 0.9,
        source: "org",
      },
    ]);
    expect(out).toContain("(entity, overlay)");
  });

  it("collapses whitespace and truncates preview to 240 chars", () => {
    const longPreview = "x".repeat(500);
    const out = formatWikiContext([
      {
        pageId: "wp1",
        slug: "summaries/long",
        title: "Long",
        pageKind: "summary",
        contentPreview: `Multi\n\n  line\tpreview   ${longPreview}`,
        isKernel: true,
        organizationId: null,
        kernelPageId: null,
        score: 0.7,
        source: "kernel",
      },
    ]);
    // The dashed preview after "— " should be <= 240 chars
    const previewPart = out!.split("— ")[1] ?? "";
    expect(previewPart.length).toBeLessThanOrEqual(240);
    // No double-space or newline survived
    expect(previewPart).not.toMatch(/\s{2,}/);
    expect(previewPart).not.toContain("\n");
  });

  it("joins multiple results with newlines", () => {
    const out = formatWikiContext([
      {
        pageId: "a",
        slug: "entities/a",
        title: "A",
        pageKind: "entity",
        contentPreview: "alpha",
        isKernel: true,
        organizationId: null,
        kernelPageId: null,
        score: 0.9,
        source: "kernel",
      },
      {
        pageId: "b",
        slug: "stances/b",
        title: "B",
        pageKind: "stance",
        contentPreview: "beta",
        isKernel: true,
        organizationId: null,
        kernelPageId: null,
        score: 0.8,
        source: "kernel",
      },
    ]);
    const lines = out!.split("\n");
    expect(lines[0]).toBe("RELEVANT WIKI CONTEXT:");
    expect(lines).toHaveLength(3);
    expect(lines[1]).toContain("entities/a");
    expect(lines[2]).toContain("stances/b");
  });
});

describe("recallWikiContext", () => {
  it("forwards query + organizationId to searchWikiPages with default limit 4", async () => {
    searchWikiPages.mockResolvedValueOnce([]);
    await recallWikiContext({ query: "portfolio anchoring", organizationId: "org_a" });
    expect(searchWikiPages).toHaveBeenCalledWith({
      query: "portfolio anchoring",
      organizationId: "org_a",
      limit: 4,
      scoreThreshold: undefined,
    });
  });

  it("returns null when search returns no results", async () => {
    searchWikiPages.mockResolvedValueOnce([]);
    const out = await recallWikiContext({ query: "q", organizationId: null });
    expect(out).toBeNull();
  });

  it("returns the formatted block when search returns results", async () => {
    searchWikiPages.mockResolvedValueOnce([
      {
        pageId: "wp1",
        slug: "entities/x",
        title: "X",
        pageKind: "entity",
        contentPreview: "An X is a Y.",
        isKernel: true,
        organizationId: null,
        kernelPageId: null,
        score: 0.8,
        source: "kernel",
      },
    ]);
    const out = await recallWikiContext({ query: "what is X?", organizationId: null });
    expect(out).toContain("RELEVANT WIKI CONTEXT:");
    expect(out).toContain("entities/x");
  });

  it("returns null silently when searchWikiPages throws", async () => {
    searchWikiPages.mockRejectedValueOnce(new Error("Qdrant down"));
    const out = await recallWikiContext({ query: "q", organizationId: null });
    expect(out).toBeNull();
  });

  it("respects an explicit limit override", async () => {
    searchWikiPages.mockResolvedValueOnce([]);
    await recallWikiContext({ query: "q", organizationId: null, limit: 10 });
    expect(searchWikiPages).toHaveBeenCalledWith(
      expect.objectContaining({ limit: 10 }),
    );
  });
});

describe("recallWikiContextWithPrinciples", () => {
  it("kicks off both retrievals and returns both blocks", async () => {
    searchWikiPages.mockResolvedValueOnce([
      {
        pageId: "wp1",
        slug: "entities/edge-node",
        title: "Edge Node",
        pageKind: "entity",
        contentPreview: "An edge node is...",
        isKernel: true,
        organizationId: null,
        kernelPageId: null,
        score: 0.9,
        source: "kernel",
      },
    ]);
    recallPrincipleContext.mockResolvedValueOnce({
      block: "GOVERNANCE PRINCIPLES:\nCommandments (1):\n- A (slug) — D",
      commandments: [{ id: "a" }],
      core: [],
      contextual: [],
    });

    const out = await recallWikiContextWithPrinciples({
      query: "what is an edge node?",
      organizationId: null,
      callingPopulation: "in_platform_coworker",
    });

    expect(searchWikiPages).toHaveBeenCalledTimes(1);
    expect(recallPrincipleContext).toHaveBeenCalledTimes(1);
    expect(out.wikiBlock).toContain("RELEVANT WIKI CONTEXT");
    expect(out.principleBlock).toContain("GOVERNANCE PRINCIPLES");
  });

  it("runs both retrievals concurrently via Promise.all (one slow branch does not delay the other's start)", async () => {
    // Concrete parallelism check: invoke both, capture timestamps of when
    // their mocks are FIRST CALLED. If the orchestrator awaits one before
    // starting the other, the second-call timestamp would be far after
    // the first-call's completion. Here both mocks should be invoked
    // back-to-back (within microtasks of each other) before either
    // promise resolves.
    const callOrder: string[] = [];
    let resolveWiki!: (v: unknown) => void;
    const wikiBlocker = new Promise((r) => (resolveWiki = r));

    searchWikiPages.mockImplementationOnce(async () => {
      callOrder.push("wiki-called");
      await wikiBlocker;
      return [];
    });
    recallPrincipleContext.mockImplementationOnce(async () => {
      callOrder.push("principle-called");
      return null;
    });

    const outPromise = recallWikiContextWithPrinciples({
      query: "x",
      organizationId: null,
      callingPopulation: "human",
    });

    // Yield one microtask so both IIFEs hit their first await.
    await Promise.resolve();
    expect(callOrder).toContain("wiki-called");
    expect(callOrder).toContain("principle-called");
    // Now release wiki and confirm the orchestrator completes
    resolveWiki([]);
    await outPromise;
  });

  it("returns wikiBlock=null when wiki retrieval throws (principles still surface)", async () => {
    searchWikiPages.mockRejectedValueOnce(new Error("Qdrant down for wiki"));
    recallPrincipleContext.mockResolvedValueOnce({
      block: "GOVERNANCE PRINCIPLES:\nCommandments (1):\n- X (slug) — D",
      commandments: [{ id: "x" }],
      core: [],
      contextual: [],
    });

    const out = await recallWikiContextWithPrinciples({
      query: "x",
      organizationId: null,
      callingPopulation: "in_platform_coworker",
    });
    expect(out.wikiBlock).toBeNull();
    expect(out.principleBlock).toContain("GOVERNANCE PRINCIPLES");
  });

  it("returns principleBlock=null when principle retrieval returns null (wiki still surfaces)", async () => {
    searchWikiPages.mockResolvedValueOnce([
      {
        pageId: "wp1",
        slug: "entities/edge-node",
        title: "Edge Node",
        pageKind: "entity",
        contentPreview: "An edge node is...",
        isKernel: true,
        organizationId: null,
        kernelPageId: null,
        score: 0.9,
        source: "kernel",
      },
    ]);
    recallPrincipleContext.mockResolvedValueOnce(null);

    const out = await recallWikiContextWithPrinciples({
      query: "x",
      organizationId: null,
      callingPopulation: "external_coding_agent",
    });
    expect(out.wikiBlock).toContain("RELEVANT WIKI CONTEXT");
    expect(out.principleBlock).toBeNull();
  });

  it("returns both null when both retrievals come up empty", async () => {
    searchWikiPages.mockResolvedValueOnce([]);
    recallPrincipleContext.mockResolvedValueOnce(null);

    const out = await recallWikiContextWithPrinciples({
      query: "x",
      organizationId: null,
      callingPopulation: "human",
    });
    expect(out.wikiBlock).toBeNull();
    expect(out.principleBlock).toBeNull();
  });

  it("forwards callingPopulation + organizationId + query to recallPrincipleContext", async () => {
    searchWikiPages.mockResolvedValueOnce([]);
    recallPrincipleContext.mockResolvedValueOnce(null);

    await recallWikiContextWithPrinciples({
      query: "should I refactor?",
      organizationId: "org_acme",
      callingPopulation: "external_coding_agent",
    });

    expect(recallPrincipleContext).toHaveBeenCalledWith(
      expect.objectContaining({
        query: "should I refactor?",
        organizationId: "org_acme",
        callingPopulation: "external_coding_agent",
      }),
    );
  });

  it("does not regress recallWikiContext's signature (string|null return) for existing callers", async () => {
    // The original function stays string | null; the new function is
    // additive. recallPrincipleContext is NOT called by recallWikiContext.
    searchWikiPages.mockResolvedValueOnce([]);
    const out = await recallWikiContext({
      query: "q",
      organizationId: null,
    });
    expect(out).toBeNull();
    expect(recallPrincipleContext).not.toHaveBeenCalled();
  });
});
