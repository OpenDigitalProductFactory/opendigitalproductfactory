import { beforeEach, describe, expect, it, vi } from "vitest";

// BI-825D3487: the knowledge read paths honour a coworker's corpus scope
// (spec 2026-10-28-corpus-scoped-read-grants-design.md §2 D4).

const searchSimilar = vi.fn();
const generateEmbedding = vi.fn();
const wikiPageFindMany = vi.fn();

vi.mock("@dpf/db", () => ({
  VECTOR_COLLECTIONS: { WIKI_PAGES: "wiki-pages" },
  upsertVectors: vi.fn(),
  deleteVectors: vi.fn(),
  searchSimilar: (...args: unknown[]) => searchSimilar(...args),
  prisma: { wikiPage: { findMany: (...args: unknown[]) => wikiPageFindMany(...args) } },
}));
vi.mock("@/lib/inference/embedding", () => ({
  generateEmbedding: (...args: unknown[]) => generateEmbedding(...args),
}));

import { searchWikiPages, searchWikiPagesLexically } from "./embeddings";
import { recallWikiContext } from "./recall";
import { corpusScopeForAgent, extraFamilyGrantKey, PERSON_CORPUS_SCOPE } from "@/lib/tak/corpus-read-scope";
import { PROFESSION_REGISTRY } from "@/lib/decision-perspective/resolve-profession-profile";

const [familyA, familyB] = PROFESSION_REGISTRY.families;
const A = familyA!.professionKey;
const B = familyB!.professionKey;
const coworker = (over: { grants?: string[]; revoked?: string[] } = {}) =>
  corpusScopeForAgent({
    agentId: "AGT-X", slugId: null, name: familyA!.roles[0]!,
    toolGrants: (over.grants ?? []).map((grantKey) => ({ grantKey })),
    toolGrantRevocations: (over.revoked ?? []).map((grantKey) => ({ grantKey })),
  }, "enforce");

function point(entityId: string, slug: string, extra: Record<string, unknown>, score = 0.8) {
  return { id: entityId, score, payload: { entityId, slug, title: slug, pageKind: "entity", contentPreview: "", kernelPageId: null, ...extra } };
}

type Filter = { must: Array<{ key: string; match: { value?: unknown } }> };
const has = (f: Filter, key: string, value: unknown) => f.must.some((c) => c.key === key && c.match.value === value);

beforeEach(() => {
  vi.clearAllMocks();
  generateEmbedding.mockResolvedValue([0.1, 0.2]);
  wikiPageFindMany.mockResolvedValue([]);
  // Route each pass by its filter, independent of call order.
  searchSimilar.mockImplementation(async (_c: string, _v: number[], filter: Filter) => {
    if (has(filter, "organizationId", "org-a")) return [point("o1", "stances/ours", { isKernel: false, organizationId: "org-a" })];
    if (has(filter, "isKernel", true)) return [point("k1", "principles/no-assumptions", { isKernel: true, organizationId: null })];
    return [
      point("pb", `professions/${B}/craft`, { isKernel: false, organizationId: null }, 0.95),
      point("pa", `professions/${A}/craft`, { isKernel: false, organizationId: null }, 0.7),
    ];
  });
});

describe("searchWikiPages with a corpus scope", () => {
  it("AC-CRG-1: a mapped coworker gets kernel, organization and its own family, never another family", async () => {
    const results = await searchWikiPages({ query: "q", organizationId: "org-a", includeProfessionCorpus: true, corpusScope: coworker() });
    expect(results.map((r) => r.pageId).sort()).toEqual(["k1", "o1", "pa"]);
  });

  it("AC-CRG-1: asking for another family's professionKey returns no profession rows", async () => {
    const results = await searchWikiPages({
      query: "q", organizationId: "org-a", includeProfessionCorpus: true, professionKeys: [B], corpusScope: coworker(),
    });
    expect(results.some((r) => r.source === "profession")).toBe(false);
  });

  it("AC-CRG-4: a revoked kernel or organization corpus runs no pass for it", async () => {
    const scope = coworker({ revoked: ["wiki_kernel_read", "wiki_org_read"] });
    const results = await searchWikiPages({ query: "q", organizationId: "org-a", includeProfessionCorpus: true, corpusScope: scope });
    expect(results.map((r) => r.pageId)).toEqual(["pa"]);
    for (const call of searchSimilar.mock.calls) {
      expect(has(call[2] as Filter, "isKernel", true)).toBe(false);
      expect(has(call[2] as Filter, "organizationId", "org-a")).toBe(false);
    }
  });

  it("AC-CRG-2: a granted extra family reads, and the coworker's own family ranks first", async () => {
    const scope = coworker({ grants: [extraFamilyGrantKey(B)] });
    const results = await searchWikiPages({ query: "q", organizationId: null, includeProfessionCorpus: true, limit: 6, corpusScope: scope });
    expect(results.filter((r) => r.source === "profession").map((r) => r.pageId)).toEqual(["pa", "pb"]);
  });

  it("people keep every family", async () => {
    const results = await searchWikiPages({ query: "q", organizationId: null, includeProfessionCorpus: true, limit: 6, corpusScope: PERSON_CORPUS_SCOPE });
    expect(results.filter((r) => r.source === "profession").map((r) => r.pageId)).toEqual(["pb", "pa"]);
  });
});

describe("lexical fallback with a corpus scope", () => {
  it("AC-CRG-1: limits the profession clause to the coworker's families", async () => {
    await searchWikiPagesLexically({ query: "craft", organizationId: "org-a", includeProfessionCorpus: true, corpusScope: coworker() });
    const where = wikiPageFindMany.mock.calls[0]![0].where as { OR: unknown[] };
    expect(where.OR).toEqual([
      { organizationId: "org-a" },
      { isKernel: true },
      { isKernel: false, organizationId: null, slug: { startsWith: `professions/${A}/` } },
    ]);
  });

  it("AC-CRG-4: drops a revoked corpus clause, and queries nothing when no corpus remains", async () => {
    await searchWikiPagesLexically({
      query: "craft", organizationId: "org-a", includeProfessionCorpus: true,
      corpusScope: coworker({ revoked: ["wiki_kernel_read", "wiki_org_read"] }),
    });
    const where = wikiPageFindMany.mock.calls[0]![0].where as Record<string, unknown>;
    expect(where).toMatchObject({ isKernel: false, organizationId: null, slug: { startsWith: `professions/${A}/` } });
    expect(where.OR).toBeUndefined();

    wikiPageFindMany.mockClear();
    const none = await searchWikiPagesLexically({
      query: "craft", organizationId: "org-a",
      corpusScope: coworker({ revoked: ["wiki_kernel_read", "wiki_org_read"] }),
    });
    expect(none).toEqual([]);
    expect(wikiPageFindMany).not.toHaveBeenCalled();
  });
});

describe("recallWikiContext with a corpus scope", () => {
  it("AC-CRG-4: skips the kernel pass for a coworker without wiki_kernel_read", async () => {
    const block = await recallWikiContext({
      query: "q", organizationId: null, corpusScope: coworker({ revoked: ["wiki_kernel_read"] }),
    });
    expect(block).toBeNull();
    expect(searchSimilar).not.toHaveBeenCalled();
    expect(wikiPageFindMany).not.toHaveBeenCalled();
  });

  it("still recalls kernel pages for a coworker that holds the grant", async () => {
    const block = await recallWikiContext({ query: "q", organizationId: null, corpusScope: coworker() });
    expect(block).toContain("principles/no-assumptions");
  });
});
