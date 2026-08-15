import { afterEach, describe, expect, it, vi } from "vitest";

const wikiPageFindMany = vi.fn();
const scrollPoints = vi.fn();

vi.mock("@dpf/db", () => ({
  QDRANT_COLLECTIONS: { WIKI_PAGES: "wiki-pages" },
  scrollPoints: (...args: unknown[]) => scrollPoints(...args),
  prisma: { wikiPage: { findMany: (...args: unknown[]) => wikiPageFindMany(...args) } },
}));

import { getOverlayEmbeddingCoverage } from "./overlay-embedding-coverage";

afterEach(() => vi.clearAllMocks());

describe("getOverlayEmbeddingCoverage (BI-D4C1E05E)", () => {
  it("reports the published-vs-embedded gap by matching pages to vector points", async () => {
    wikiPageFindMany.mockResolvedValue([
      { id: "a", slug: "stances/one" },
      { id: "b", slug: "stances/two" },
      { id: "c", slug: "stances/three" },
    ]);
    // Only a and c have vector rows; b is published but not embedded.
    scrollPoints.mockResolvedValue([
      { payload: { entityId: "a" } },
      { payload: { entityId: "c" } },
    ]);
    const cov = await getOverlayEmbeddingCoverage("org1");
    expect(cov.published).toBe(3);
    expect(cov.embedded).toBe(2);
    expect(cov.pending).toBe(1);
    expect(cov.pendingSlugs).toEqual(["stances/two"]);
    expect(cov.degraded).toBe(false);
  });

  it("fails open (degraded, never throws) when the vector store is unreachable", async () => {
    wikiPageFindMany.mockResolvedValue([{ id: "a", slug: "stances/one" }]);
    scrollPoints.mockRejectedValue(new Error("store down"));
    const cov = await getOverlayEmbeddingCoverage("org1");
    expect(cov.degraded).toBe(true);
    expect(cov.published).toBe(0);
  });
});
