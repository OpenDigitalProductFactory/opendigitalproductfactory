import { beforeEach, describe, expect, it, vi } from "vitest";

const semanticMemory = vi.hoisted(() => ({
  searchPlatformKnowledge: vi.fn(),
  searchKnowledgeArticles: vi.fn(),
  storeKnowledgeArticle: vi.fn(),
}));
vi.mock("@/lib/semantic-memory", () => semanticMemory);

const db = vi.hoisted(() => ({
  prisma: {
    knowledgeArticle: {
      findFirst: vi.fn(),
      create: vi.fn(),
      findMany: vi.fn(),
    },
  },
}));
vi.mock("@dpf/db", () => db);

import { knowledgePack } from "./knowledge-pack";
import { isToolAllowedByGrants } from "@/lib/tak/agent-grants";

const EXPECTED_TOOLS = [
  "search_knowledge",
  "search_knowledge_base",
  "create_knowledge_article",
  "flag_stale_knowledge",
];

beforeEach(() => {
  vi.clearAllMocks();
});

describe("knowledge pack — registration", () => {
  it("exposes exactly the four knowledge tools", () => {
    expect(knowledgePack.definitions.map((d) => d.name).sort()).toEqual([...EXPECTED_TOOLS].sort());
    expect(Object.keys(knowledgePack.handlers).sort()).toEqual([...EXPECTED_TOOLS].sort());
  });

  it("descriptions are provenance-free (no BI/Phase/path leakage)", () => {
    for (const d of knowledgePack.definitions) {
      expect(d.description).not.toMatch(/\bBI-|Phase \d|EP-|apps\/web\//);
    }
  });

  it("grants mirror agent-grants: read tools need registry_read, the writer needs registry_write", () => {
    for (const t of ["search_knowledge", "search_knowledge_base", "flag_stale_knowledge"]) {
      expect(knowledgePack.grants[t]).toEqual(["registry_read"]);
      expect(isToolAllowedByGrants(t, ["registry_read"])).toBe(true);
    }
    expect(knowledgePack.grants.create_knowledge_article).toEqual(["registry_write"]);
    expect(isToolAllowedByGrants("create_knowledge_article", ["registry_write"])).toBe(true);
  });
});

describe("knowledge pack — handler behavior (delegation preserved)", () => {
  it("search_knowledge summarizes semantic results from the service", async () => {
    semanticMemory.searchPlatformKnowledge.mockResolvedValue({
      status: "ok",
      results: [{ entityType: "backlog", entityId: "BI-1", title: "Widget", score: 0.9 }],
    });
    const res = await knowledgePack.handlers.search_knowledge({ query: "widget" }, "u1");
    expect(res.success).toBe(true);
    expect(res.message).toContain("backlog:BI-1");
    expect(res.message).toContain("90% match");
    expect(semanticMemory.searchPlatformKnowledge).toHaveBeenCalledWith({
      query: "widget",
      entityType: undefined,
      limit: 5,
    });
  });

  it("search_knowledge returns an empty result set when nothing matches", async () => {
    semanticMemory.searchPlatformKnowledge.mockResolvedValue({ status: "ok", results: [] });
    const res = await knowledgePack.handlers.search_knowledge({ query: "none" }, "u1");
    expect(res.success).toBe(true);
    expect(res.data).toEqual({ results: [] });
  });

  it("search_knowledge fails loudly when retrieval is unavailable (BI-339C441F)", async () => {
    // The regression: this used to be indistinguishable from the case above,
    // so a caller told to "search before you create" read an outage as a
    // clean duplicate check.
    semanticMemory.searchPlatformKnowledge.mockResolvedValue({
      status: "unavailable",
      reason: "the embedding model did not return a vector for this query",
      results: [],
    });
    const res = await knowledgePack.handlers.search_knowledge({ query: "none" }, "u1");

    expect(res.success).toBe(false);
    expect(res.message).toContain("unavailable");
    expect(res.message).toContain('NOT "no results"');
    expect(res.data).toMatchObject({ searchStatus: "unavailable" });
  });

  it("search_knowledge_base forwards the article filters to the service", async () => {
    semanticMemory.searchKnowledgeArticles.mockResolvedValue([
      { category: "policy", articleId: "KA-001", title: "PTO", score: 0.5 },
    ]);
    const res = await knowledgePack.handlers.search_knowledge_base(
      { query: "pto", category: "policy", limit: 3 },
      "u1",
    );
    expect(res.success).toBe(true);
    expect(res.message).toContain("policy:KA-001");
    expect(semanticMemory.searchKnowledgeArticles).toHaveBeenCalledWith({
      query: "pto",
      productId: undefined,
      portfolioId: undefined,
      category: "policy",
      valueStream: undefined,
      limit: 3,
    });
  });

  it("create_knowledge_article drafts KA-001 and indexes it", async () => {
    db.prisma.knowledgeArticle.findFirst.mockResolvedValue(null);
    db.prisma.knowledgeArticle.create.mockResolvedValue({ articleId: "KA-001" });
    const res = await knowledgePack.handlers.create_knowledge_article(
      { title: "How to X", body: "steps", category: "how-to" },
      "user-42",
    );
    expect(res.success).toBe(true);
    expect(res.entityId).toBe("KA-001");
    const createArg = db.prisma.knowledgeArticle.create.mock.calls[0][0];
    expect(createArg.data.articleId).toBe("KA-001");
    expect(createArg.data.authorId).toBe("user-42");
    expect(createArg.data.status).toBe("draft");
    expect(semanticMemory.storeKnowledgeArticle).toHaveBeenCalledWith(
      expect.objectContaining({ articleId: "KA-001", status: "draft" }),
    );
  });

  it("create_knowledge_article increments from the latest KA id", async () => {
    db.prisma.knowledgeArticle.findFirst.mockResolvedValue({ articleId: "KA-041" });
    db.prisma.knowledgeArticle.create.mockResolvedValue({ articleId: "KA-042" });
    const res = await knowledgePack.handlers.create_knowledge_article(
      { title: "T", body: "B", category: "reference" },
      "u1",
    );
    expect(res.entityId).toBe("KA-042");
  });

  it("flag_stale_knowledge returns only overdue published articles", async () => {
    const now = Date.now();
    db.prisma.knowledgeArticle.findMany.mockResolvedValue([
      { articleId: "KA-001", title: "Old", category: "policy", reviewIntervalDays: 30, lastReviewedAt: new Date(now - 100 * 86400000), createdAt: new Date(now - 200 * 86400000) },
      { articleId: "KA-002", title: "Fresh", category: "policy", reviewIntervalDays: 30, lastReviewedAt: new Date(now - 1 * 86400000), createdAt: new Date(now - 2 * 86400000) },
    ]);
    const res = await knowledgePack.handlers.flag_stale_knowledge({}, "u1");
    expect(res.success).toBe(true);
    expect(res.message).toContain("KA-001");
    expect(res.message).not.toContain("KA-002");
    expect((res.data as { articles: unknown[] }).articles).toHaveLength(1);
  });

  it("flag_stale_knowledge reports all-up-to-date when nothing is overdue", async () => {
    db.prisma.knowledgeArticle.findMany.mockResolvedValue([]);
    const res = await knowledgePack.handlers.flag_stale_knowledge({ productId: "p1" }, "u1");
    expect(res.success).toBe(true);
    expect(res.data).toEqual({ articles: [] });
  });
});
