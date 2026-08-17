import { afterEach, describe, expect, it, vi } from "vitest";

const { mockPrisma } = vi.hoisted(() => ({
  mockPrisma: {
    organization: {
      findFirst: vi.fn(),
    },
  },
}));

const searchWikiPages = vi.fn();

vi.mock("@dpf/db", () => ({
  prisma: mockPrisma,
  QDRANT_COLLECTIONS: { WIKI_PAGES: "wiki-pages" },
}));

vi.mock("@/lib/wiki/embeddings", () => ({
  searchWikiPages: (...args: unknown[]) => searchWikiPages(...args),
}));

import { executeTool } from "./mcp-tools";

afterEach(() => {
  mockPrisma.organization.findFirst.mockReset();
  searchWikiPages.mockReset();
});

describe("wiki_query MCP tool", () => {
  it("returns 'no matching pages' message when search is empty", async () => {
    mockPrisma.organization.findFirst.mockResolvedValueOnce({ id: "org_a" });
    searchWikiPages.mockResolvedValueOnce([]);

    const res = await executeTool("wiki_query", { query: "what is a digital product?" }, "user_test");

    expect(res.success).toBe(true);
    expect(res.message).toContain("No matching wiki pages found.");
    expect(res.data).toEqual({ results: [], retrievalMode: "vector" });
  });

  it("forwards organization id, query, pageKind, and limit to searchWikiPages", async () => {
    mockPrisma.organization.findFirst.mockResolvedValueOnce({ id: "org_acme" });
    searchWikiPages.mockResolvedValueOnce([]);

    await executeTool(
      "wiki_query",
      {
        query: "Mark's stance on portfolio anchoring",
        pageKind: "stance",
        limit: 8,
      },
      "user_test",
    );

    expect(searchWikiPages).toHaveBeenCalledWith({
      query: "Mark's stance on portfolio anchoring",
      organizationId: "org_acme",
      pageKind: "stance",
      limit: 8,
      // WSID profession corpus rides in wiki_query by default (BI-CC44E74F).
      includeProfessionCorpus: true,
      professionKeys: undefined,
    });
  });

  it("falls back to organizationId=null when no organization exists", async () => {
    mockPrisma.organization.findFirst.mockResolvedValueOnce(null);
    searchWikiPages.mockResolvedValueOnce([]);

    await executeTool("wiki_query", { query: "q" }, "user_test");

    expect(searchWikiPages).toHaveBeenCalledWith(
      expect.objectContaining({ organizationId: null, limit: 5 }),
    );
  });

  it("formats a summary line per result including kernel/overlay origin", async () => {
    mockPrisma.organization.findFirst.mockResolvedValueOnce({ id: "org_a" });
    searchWikiPages.mockResolvedValueOnce([
      {
        pageId: "wp_1",
        slug: "entities/digital-product",
        title: "Digital Product",
        pageKind: "entity",
        contentPreview: "A digital product is...",
        isKernel: true,
        organizationId: null,
        kernelPageId: null,
        score: 0.82,
        source: "kernel",
      },
      {
        pageId: "wp_2",
        slug: "stances/portfolio-as-anchor",
        title: "Portfolio as Anchor",
        pageKind: "stance",
        contentPreview: "Portfolio is the unit of...",
        isKernel: false,
        organizationId: "org_a",
        kernelPageId: "wp_kernel_x",
        score: 0.91,
        source: "org",
      },
    ]);

    const res = await executeTool("wiki_query", { query: "q" }, "user_test");

    expect(res.success).toBe(true);
    const lines = (res.message ?? "").split("\n");
    expect(lines[0]).toContain("entities/digital-product (entity, kernel)");
    expect(lines[0]).toContain("82% match");
    expect(lines[1]).toContain("stances/portfolio-as-anchor (stance, org)");
    expect(lines[1]).toContain("91% match");
  });

  it("survives an organization lookup failure (kernel-only fallback)", async () => {
    mockPrisma.organization.findFirst.mockRejectedValueOnce(new Error("DB down"));
    searchWikiPages.mockResolvedValueOnce([]);

    const res = await executeTool("wiki_query", { query: "q" }, "user_test");

    expect(res.success).toBe(true);
    expect(searchWikiPages).toHaveBeenCalledWith(
      expect.objectContaining({ organizationId: null }),
    );
  });
});

describe("wiki_query MCP tool: principle filters (Task 2.4)", () => {
  it("translates tier to principleTier for searchWikiPages", async () => {
    mockPrisma.organization.findFirst.mockResolvedValueOnce({ id: "org_a" });
    searchWikiPages.mockResolvedValueOnce([]);

    await executeTool(
      "wiki_query",
      { query: "evidence over inference", pageKind: "principle", tier: "commandment" },
      "user_test",
    );

    expect(searchWikiPages).toHaveBeenCalledWith(
      expect.objectContaining({
        pageKind: "principle",
        principleTier: "commandment",
      }),
    );
  });

  it("translates appliesTo to principleAppliesTo for searchWikiPages", async () => {
    mockPrisma.organization.findFirst.mockResolvedValueOnce({ id: "org_a" });
    searchWikiPages.mockResolvedValueOnce([]);

    await executeTool(
      "wiki_query",
      {
        query: "long-term maintainability",
        pageKind: "principle",
        appliesTo: "external_coding_agent",
      },
      "user_test",
    );

    expect(searchWikiPages).toHaveBeenCalledWith(
      expect.objectContaining({
        principleAppliesTo: "external_coding_agent",
      }),
    );
  });

  it("translates publicOnly=true to principlePublic=true for searchWikiPages", async () => {
    mockPrisma.organization.findFirst.mockResolvedValueOnce({ id: "org_a" });
    searchWikiPages.mockResolvedValueOnce([]);

    await executeTool(
      "wiki_query",
      { query: "principles", pageKind: "principle", publicOnly: true },
      "user_test",
    );

    expect(searchWikiPages).toHaveBeenCalledWith(
      expect.objectContaining({ principlePublic: true }),
    );
  });

  it("does NOT forward principle filters when caller omits them (backwards compat)", async () => {
    mockPrisma.organization.findFirst.mockResolvedValueOnce({ id: "org_a" });
    searchWikiPages.mockResolvedValueOnce([]);

    await executeTool(
      "wiki_query",
      { query: "q", pageKind: "stance" },
      "user_test",
    );

    const callArgs = searchWikiPages.mock.calls[0][0] as Record<string, unknown>;
    expect(callArgs.principleTier).toBeUndefined();
    expect(callArgs.principleAppliesTo).toBeUndefined();
    expect(callArgs.principlePublic).toBeUndefined();
  });

  it("surfaces principle metadata in the result data when pageKind = principle", async () => {
    mockPrisma.organization.findFirst.mockResolvedValueOnce({ id: "org_a" });
    searchWikiPages.mockResolvedValueOnce([
      {
        pageId: "wp_arch",
        slug: "principles/architecture-over-shortcuts",
        title: "Architecture Over Shortcuts",
        pageKind: "principle",
        contentPreview: "Prefer long-term...",
        isKernel: true,
        organizationId: null,
        kernelPageId: null,
        score: 0.91,
        source: "kernel",
        principleTier: "commandment",
        principleAppliesTo: ["in_platform_coworker", "external_coding_agent"],
        principleDimensions: ["long_term_maintainability", "schema_grounding"],
        principlePublic: true,
      },
    ]);

    const res = await executeTool(
      "wiki_query",
      { query: "architecture decisions", pageKind: "principle" },
      "user_test",
    );

    expect(res.success).toBe(true);
    const data = res.data as { results: Array<Record<string, unknown>> };
    expect(data.results[0]).toMatchObject({
      pageId: "wp_arch",
      pageKind: "principle",
      principleTier: "commandment",
      principleAppliesTo: ["in_platform_coworker", "external_coding_agent"],
      principleDimensions: ["long_term_maintainability", "schema_grounding"],
      principlePublic: true,
    });
  });

  it("includes tier in the summary line for principle results so authors see it at a glance", async () => {
    mockPrisma.organization.findFirst.mockResolvedValueOnce({ id: "org_a" });
    searchWikiPages.mockResolvedValueOnce([
      {
        pageId: "wp_ev",
        slug: "principles/evidence-before-diagnosis",
        title: "Evidence Before Diagnosis",
        pageKind: "principle",
        contentPreview: "Prefer queried state...",
        isKernel: true,
        organizationId: null,
        kernelPageId: null,
        score: 0.88,
        source: "kernel",
        principleTier: "commandment",
        principleAppliesTo: ["in_platform_coworker"],
        principleDimensions: ["evidence_density"],
        principlePublic: true,
      },
    ]);

    const res = await executeTool(
      "wiki_query",
      { query: "evidence", pageKind: "principle" },
      "user_test",
    );

    expect(res.message).toContain("commandment");
    expect(res.message).toContain("Evidence Before Diagnosis");
  });
});
