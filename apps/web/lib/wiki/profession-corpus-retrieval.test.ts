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
    // Located by its cohort filter rather than by call index: pass C runs
    // before pass B (BI-F3FB4F41), so the ordinal is not part of the contract.
    type Clause = { key: string; match: Record<string, unknown> };
    const professionFilter = qdrant.searchSimilar.mock.calls
      .map((c: unknown[]) => c[2] as { must: Clause[] })
      .find((f) => f.must.some((m) => m.key === "isKernel" && m.match.value === false))!;
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

// BI-F3FB4F41 — the profession pass must survive a DENSE corpus.
//
// The fixtures above are sparse: passes A and B return fewer rows than `limit`,
// so a profession pass appended last still fits. Production is not sparse —
// pass B sizes itself to `limit - orgResults.length`, so A and B together fill
// `limit` exactly and anything concatenated after them is sliced away. These
// tests pin the reserved-share behaviour against a corpus dense enough to
// reproduce that, which is the only shape that catches the regression.
describe("semantic retrieval — profession share on a dense corpus (BI-F3FB4F41)", () => {
  const vec = Array.from({ length: 8 }, () => 0.1);

  /** Qdrant-shaped hit whose payload carries the fields projectResult reads. */
  const hit = (slug: string, isKernel: boolean, organizationId: string | null, score: number) => ({
    id: slug,
    score,
    payload: {
      entityId: slug,
      entityType: "wiki-page",
      slug,
      title: slug,
      status: "published",
      pageKind: "principle",
      isKernel,
      organizationId,
      kernelPageId: null,
      contentPreview: slug,
    },
  });

  /** Routes each pass by the filter it was called with, then honours its limit. */
  const denseCorpus = () => {
    qdrant.searchSimilar.mockImplementation(
      async (_c: string, _v: number[], filter: Record<string, unknown>, lim: number) => {
        const must = (filter.must ?? []) as Array<{ key: string; match: { value: unknown } }>;
        const clause = (key: string) => must.find((m) => m.key === key)?.match?.value;
        const isKernel = clause("isKernel");
        const org = clause("organizationId");
        if (isKernel === true) {
          return Array.from({ length: 50 }, (_, i) => hit(`principles/kernel-${i}`, true, null, 0.9 - i / 100)).slice(0, lim);
        }
        if (isKernel === false && org === null) {
          return Array.from({ length: 50 }, (_, i) =>
            hit(`professions/data-architect/craft-${i}`, false, null, 0.95 - i / 100),
          ).slice(0, lim);
        }
        if (typeof org === "string") {
          return Array.from({ length: 50 }, (_, i) => hit(`stances/org-${i}`, false, org, 0.8 - i / 100)).slice(0, lim);
        }
        return [];
      },
    );
    embedding.generateEmbedding.mockResolvedValue(vec);
  };

  beforeEach(denseCorpus);

  it("returns profession pages even though org+kernel could fill the limit alone", async () => {
    const results = await searchWikiPages({
      query: "referential integrity",
      organizationId: "org-1",
      limit: 25,
      includeProfessionCorpus: true,
    });
    expect(results).toHaveLength(25);
    expect(results.filter((r) => r.source === "profession").length).toBeGreaterThan(0);
  });

  it("leads with craft doctrine when the caller scoped to a professionKey", async () => {
    const results = await searchWikiPages({
      query: "referential integrity",
      organizationId: "org-1",
      limit: 9,
      includeProfessionCorpus: true,
      professionKeys: ["data-architect"],
    });
    expect(results[0]?.source).toBe("profession");
    // Scoped share is two thirds of the limit; kernel doctrine still present.
    expect(results.filter((r) => r.source === "profession")).toHaveLength(6);
    expect(results.some((r) => r.source !== "profession")).toBe(true);
  });

  it("keeps org+kernel whole when the profession pass is not opted in", async () => {
    const results = await searchWikiPages({
      query: "referential integrity",
      organizationId: "org-1",
      limit: 25,
    });
    expect(results).toHaveLength(25);
    expect(results.every((r) => r.source !== "profession")).toBe(true);
  });
});
