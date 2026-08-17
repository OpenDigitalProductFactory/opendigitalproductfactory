// BI-CC44E74F — WSID profession corpus retrievability through wiki search.
//
// Profession pages are seeded `isKernel: false` / `organizationId: null`, the
// exact cohort the org (pass A) and kernel (pass B) retrieval passes exclude
// by construction. These tests pin the opt-in third pass on the Postgres
// lexical path (the semantic path shares the same input contract and cohort
// definition; its Qdrant filter is exercised via the shared cohort test on
// searchWikiPages below).

import { beforeEach, describe, expect, it, vi } from "vitest";

const db = vi.hoisted(() => ({
  wikiPage: { findMany: vi.fn() },
}));
const qdrant = vi.hoisted(() => ({
  searchSimilar: vi.fn(),
}));
vi.mock("@dpf/db", () => ({
  prisma: db,
  QDRANT_COLLECTIONS: { WIKI_PAGES: "wiki-pages" },
  upsertVectors: vi.fn(),
  searchSimilar: (...a: unknown[]) => qdrant.searchSimilar(...a),
  deleteVectors: vi.fn(),
}));

const embedding = vi.hoisted(() => ({ generateEmbedding: vi.fn() }));
vi.mock("@/lib/inference/embedding", () => ({
  generateEmbedding: (...a: unknown[]) => embedding.generateEmbedding(...a),
}));

import { searchWikiPages, searchWikiPagesLexically } from "./embeddings";

const professionRow = {
  id: "p1",
  slug: "professions/data-architect/referential-integrity-is-declared-not-implied",
  title: "Referential integrity is declared, not implied",
  body: "Declare every FK-shaped column as a real relation with a leading index.",
  abstract: "referential integrity relations",
  pageKind: "principle",
  isKernel: false,
  organizationId: null,
  kernelPageId: null,
  principleTier: "core",
  principleAppliesTo: ["in_platform_coworker"],
  principleRingScope: ["ring-2-workflow"],
  principleDimensions: ["schema_grounding"],
  principlePublic: false,
};

beforeEach(() => {
  vi.clearAllMocks();
});

describe("lexical retrieval — profession pass (BI-CC44E74F)", () => {
  it("excludes profession rows by default (org→kernel overlay contract unchanged)", async () => {
    db.wikiPage.findMany.mockResolvedValue([]);
    await searchWikiPagesLexically({ query: "referential integrity", organizationId: null });
    const where = db.wikiPage.findMany.mock.calls[0][0].where;
    expect(where).toMatchObject({ isKernel: true });
    expect(JSON.stringify(where)).not.toContain("professions/");
  });

  it("includes the profession cohort when opted in, labeled source=profession", async () => {
    db.wikiPage.findMany.mockResolvedValue([professionRow]);
    const results = await searchWikiPagesLexically({
      query: "referential integrity",
      organizationId: null,
      includeProfessionCorpus: true,
    });
    const where = db.wikiPage.findMany.mock.calls[0][0].where;
    expect(JSON.stringify(where)).toContain("professions/");
    expect(results).toHaveLength(1);
    expect(results[0].source).toBe("profession");
    expect(results[0].slug).toBe(professionRow.slug);
  });

  it("scopes the profession clause to the requested professionKeys", async () => {
    db.wikiPage.findMany.mockResolvedValue([]);
    await searchWikiPagesLexically({
      query: "referential integrity",
      organizationId: "org-1",
      includeProfessionCorpus: true,
      professionKeys: ["data-architect"],
    });
    const where = db.wikiPage.findMany.mock.calls[0][0].where;
    expect(JSON.stringify(where)).toContain("professions/data-architect/");
    expect(JSON.stringify(where)).not.toContain('"professions/"');
  });
});

describe("semantic retrieval — profession pass (BI-CC44E74F)", () => {
  it("runs a third Qdrant pass over the isKernel:false / organizationId:null cohort when opted in", async () => {
    embedding.generateEmbedding.mockResolvedValue([0.1, 0.2]);
    qdrant.searchSimilar.mockResolvedValue([]);
    db.wikiPage.findMany.mockResolvedValue([]); // lexical fallback on empty semantic results
    await searchWikiPages({
      query: "referential integrity",
      organizationId: null,
      includeProfessionCorpus: true,
      professionKeys: ["data-architect"],
    });
    // Pass B (kernel) + pass C (profession); no org pass without an org.
    expect(qdrant.searchSimilar).toHaveBeenCalledTimes(2);
    const professionFilter = qdrant.searchSimilar.mock.calls[1][2] as {
      must: Array<{ key: string; match: Record<string, unknown> }>;
    };
    expect(professionFilter.must).toEqual(
      expect.arrayContaining([
        { key: "isKernel", match: { value: false } },
        { key: "organizationId", match: { value: null } },
      ]),
    );
  });

  it("does not run the profession pass by default", async () => {
    embedding.generateEmbedding.mockResolvedValue([0.1, 0.2]);
    qdrant.searchSimilar.mockResolvedValue([
      { score: 0.9, payload: { entityId: "k1", slug: "principles/x", title: "X", pageKind: "principle", isKernel: true, organizationId: null, kernelPageId: null, contentPreview: "" } },
    ]);
    await searchWikiPages({ query: "anything", organizationId: null });
    expect(qdrant.searchSimilar).toHaveBeenCalledTimes(1);
  });
});
