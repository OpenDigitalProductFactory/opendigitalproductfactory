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
    expect(res.data).toEqual({ results: [] });
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
