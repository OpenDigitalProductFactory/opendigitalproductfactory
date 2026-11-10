import { beforeEach, describe, expect, it, vi } from "vitest";

// BI-825D3487: the knowledge tools honour the caller's corpus grants
// (spec 2026-10-28-corpus-scoped-read-grants-design.md §2 D3–D4).

const { db } = vi.hoisted(() => ({
  db: {
    organization: { findFirst: vi.fn() },
    agent: { findFirst: vi.fn() },
    toolExecution: { create: vi.fn() },
  },
}));
vi.mock("@dpf/db", () => ({ prisma: db, VECTOR_COLLECTIONS: { WIKI_PAGES: "wiki-pages" } }));

const searchWikiPages = vi.fn();
const searchWikiPagesLexically = vi.fn();
vi.mock("@/lib/wiki/embeddings", () => ({
  searchWikiPages: (...args: unknown[]) => searchWikiPages(...args),
  searchWikiPagesLexically: (...args: unknown[]) => searchWikiPagesLexically(...args),
}));
const searchByPPR = vi.fn();
vi.mock("@/lib/wiki/ppr", () => ({ searchByPPR: (...args: unknown[]) => searchByPPR(...args) }));
const searchKnowledgeArticles = vi.fn();
vi.mock("@/lib/semantic-memory", () => ({ searchKnowledgeArticles: (...args: unknown[]) => searchKnowledgeArticles(...args) }));

import { wikiPack } from "./wiki-pack";
import { knowledgePack } from "./knowledge-pack";
import { principleDecidePack } from "./principle-decide-pack";
import { professionDecisionPack } from "./profession-decision-pack";
import { PROFESSION_REGISTRY } from "@/lib/decision-perspective/resolve-profession-profile";

const [familyA] = PROFESSION_REGISTRY.families;
const A = familyA!.professionKey;
const professionRow = { pageId: "p1", slug: "professions/some-family/craft", title: "Craft", pageKind: "entity", source: "profession", organizationId: null, score: 0.8 };

function coworkerRow(name: string, revoked: string[] = []) {
  return { agentId: "AGT-X", slugId: null, name, toolGrants: [], toolGrantRevocations: revoked.map((grantKey) => ({ grantKey })) };
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.unstubAllEnvs();
  db.organization.findFirst.mockResolvedValue({ id: "org-a", wikiRetrievalMode: "vector" });
  db.toolExecution.create.mockResolvedValue({ id: "te-1" });
  searchWikiPages.mockResolvedValue([]);
  searchWikiPagesLexically.mockResolvedValue([]);
  searchByPPR.mockResolvedValue([]);
});

describe("wiki_query", () => {
  it("AC-CRG-1: passes a mapped coworker's own-family scope to vector search", async () => {
    db.agent.findFirst.mockResolvedValue(coworkerRow(familyA!.roles[0]!));
    await wikiPack.handlers.wiki_query!({ query: "q" }, "u1", { agentId: "AGT-X" });
    const args = searchWikiPages.mock.calls[0]![0] as { corpusScope: { professionFamilies: Set<string>; kernel: boolean } };
    expect([...args.corpusScope.professionFamilies]).toEqual([A]);
    expect(args.corpusScope.kernel).toBe(true);
  });

  it("AC-CRG-1/5: passes the scope to the lexical and ppr modes too", async () => {
    db.agent.findFirst.mockResolvedValue(coworkerRow(familyA!.roles[0]!, ["wiki_org_read"]));
    await wikiPack.handlers.wiki_query!({ query: "q", retrievalMode: "lexical" }, "u1", { agentId: "AGT-X" });
    await wikiPack.handlers.wiki_query!({ query: "q", retrievalMode: "ppr" }, "u1", { agentId: "AGT-X" });
    expect(searchWikiPagesLexically.mock.calls[0]![0]).toMatchObject({ corpusScope: { organization: false } });
    expect(searchByPPR.mock.calls[0]![0]).toMatchObject({ corpusScope: { organization: false } });
  });

  it("people are not family-limited: no scope is passed", async () => {
    await wikiPack.handlers.wiki_query!({ query: "q" }, "u1", {});
    expect(searchWikiPages.mock.calls[0]![0]).not.toHaveProperty("corpusScope");
    expect(db.agent.findFirst).not.toHaveBeenCalled();
  });

  it("AC-CRG-3: report-only keeps an unmapped coworker's profession pages and records the read", async () => {
    db.agent.findFirst.mockResolvedValue(coworkerRow("no-such-role"));
    searchWikiPages.mockResolvedValue([professionRow]);
    const res = await wikiPack.handlers.wiki_query!({ query: "q" }, "u1", { agentId: "AGT-X", threadId: "t-1" });
    expect(res.data?.results).toEqual([professionRow]);
    expect(searchWikiPages.mock.calls[0]![0]).toMatchObject({ corpusScope: { professionFamilies: null, reportOnlyUnmapped: true } });
    expect(db.toolExecution.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        threadId: "corpus-grant-report:AGT-X", toolName: "wiki_query",
        result: { slugs: ["professions/some-family/craft"] },
      }),
    });
  });

  it("AC-CRG-3: enforce gives an unmapped coworker no profession family and records nothing", async () => {
    vi.stubEnv("DPF_WIKI_CORPUS_GRANT_MODE", "enforce");
    db.agent.findFirst.mockResolvedValue(coworkerRow("no-such-role"));
    await wikiPack.handlers.wiki_query!({ query: "q" }, "u1", { agentId: "AGT-X" });
    const args = searchWikiPages.mock.calls[0]![0] as { corpusScope: { professionFamilies: Set<string> } };
    expect(args.corpusScope.professionFamilies.size).toBe(0);
    expect(db.toolExecution.create).not.toHaveBeenCalled();
  });

  it("a mapped coworker's read records no report", async () => {
    db.agent.findFirst.mockResolvedValue(coworkerRow(familyA!.roles[0]!));
    searchWikiPages.mockResolvedValue([professionRow]);
    await wikiPack.handlers.wiki_query!({ query: "q" }, "u1", { agentId: "AGT-X" });
    expect(db.toolExecution.create).not.toHaveBeenCalled();
  });
});

describe("refusals", () => {
  it("AC-CRG-4: search_knowledge_base refuses without wiki_org_read", async () => {
    db.agent.findFirst.mockResolvedValue(coworkerRow(familyA!.roles[0]!, ["wiki_org_read"]));
    const res = await knowledgePack.handlers.search_knowledge_base!({ query: "q" }, "u1", { agentId: "AGT-X" });
    expect(res).toMatchObject({ success: false, error: "corpus_grant_missing" });
    expect(res.message).toContain("wiki_org_read");
    expect(searchKnowledgeArticles).not.toHaveBeenCalled();
  });

  it("search_knowledge_base still answers a coworker that holds the grant", async () => {
    db.agent.findFirst.mockResolvedValue(coworkerRow(familyA!.roles[0]!));
    searchKnowledgeArticles.mockResolvedValue([]);
    const res = await knowledgePack.handlers.search_knowledge_base!({ query: "q" }, "u1", { agentId: "AGT-X" });
    expect(res.success).toBe(true);
  });

  it("AC-CRG-4: principle_decide refuses without wiki_kernel_read, naming the grant", async () => {
    db.agent.findFirst.mockResolvedValue(coworkerRow(familyA!.roles[0]!, ["wiki_kernel_read"]));
    const res = await principleDecidePack.handlers.principle_decide!(
      { context: "c", options: ["a", "b"], callingPopulation: "in_platform_coworker" }, "u1", { agentId: "AGT-X" },
    );
    expect(res).toMatchObject({ success: false, error: "corpus_grant_missing" });
    expect(res.message).toContain("wiki_kernel_read");
  });

  it("AC-CRG-4: evaluate_profession_decision refuses when the coworker's family is outside its set, naming the family", async () => {
    db.agent.findFirst.mockResolvedValue(coworkerRow(familyA!.roles[0]!, ["wiki_profession_read"]));
    const res = await professionDecisionPack.handlers.evaluate_profession_decision!(
      { question: "q", options: ["a"], domainClass: "x", riskTier: "y" }, "u1", { agentId: "AGT-X" },
    );
    expect(res).toMatchObject({ success: false, error: "corpus_family_not_granted" });
    expect(res.message).toContain(A);
  });
});
