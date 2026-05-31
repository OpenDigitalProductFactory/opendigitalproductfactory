import { describe, expect, it, vi } from "vitest";

import {
  getMaterialBacklinks,
  type MaterialBacklinksDbClient,
} from "./material-backlinks";

function makeDb(overrides: Partial<MaterialBacklinksDbClient> = {}): MaterialBacklinksDbClient {
  return {
    perspectiveMaterial: {
      findUnique: vi.fn().mockResolvedValue({
        materialId: "PM-1",
        profileId: "profile-mark",
        sourceType: "principle",
        sourceRef: { wikiPageId: "WP-1", wikiSlug: "principles/test" },
        summary: "Architecture over shortcuts",
        domainClass: "architecture-tradeoff",
        direction: "support",
        reviewStatus: "approved",
        promotionState: "promoted",
      }),
    },
    wikiPage: {
      findFirst: vi.fn().mockResolvedValue({
        id: "WP-1",
        slug: "principles/test",
        title: "Architecture Over Shortcuts",
        pageKind: "principle",
        status: "published",
        isKernel: true,
      }),
    },
    wikiPageLink: {
      findMany: vi
        .fn()
        .mockResolvedValueOnce([
          {
            fromPageId: "WP-2",
            toPageId: "WP-1",
            fromPage: {
              id: "WP-2",
              slug: "stances/platform-shape",
              title: "Platform Shape",
              pageKind: "stance",
              status: "published",
              isKernel: true,
            },
          },
        ])
        .mockResolvedValueOnce([
          {
            fromPageId: "WP-1",
            toPageId: "WP-3",
            toPage: {
              id: "WP-3",
              slug: "heuristics/reuse-before-new",
              title: "Reuse Before New",
              pageKind: "heuristic",
              status: "published",
              isKernel: true,
            },
          },
        ]),
    },
    wikiPageSource: {
      findMany: vi.fn().mockResolvedValue([
        {
          pageId: "WP-1",
          sourceId: "RS-1",
          source: {
            id: "RS-1",
            sourceKey: "source-1",
            title: "Source One",
            sourceType: "article",
            url: "https://example.com/source",
            abstract: "A useful source.",
          },
        },
      ]),
    },
    decisionInteraction: {
      findMany: vi.fn().mockResolvedValue([
        {
          interactionId: "DI-1",
          profileId: "profile-mark",
          question: "Which architecture should we choose?",
          outcomeType: "recommend",
          sources: [{ materialId: "PM-1" }],
          createdAt: new Date("2026-05-31T12:00:00.000Z"),
        },
        {
          interactionId: "DI-2",
          profileId: "profile-mark",
          question: "Unrelated",
          outcomeType: "recommend",
          sources: [{ materialId: "PM-X" }],
          createdAt: new Date("2026-05-31T13:00:00.000Z"),
        },
      ]),
    },
    ...overrides,
  };
}

describe("getMaterialBacklinks", () => {
  it("returns wiki links, stance/heuristic neighbors, citations, and prior decisions", async () => {
    const result = await getMaterialBacklinks({
      db: makeDb(),
      target: { materialId: "PM-1" },
    });

    expect(result.missingReason).toBe("none");
    expect(result.material.materialId).toBe("PM-1");
    expect(result.material.wikiPageId).toBe("WP-1");
    expect(result.wikiNeighborhood.page?.slug).toBe("principles/test");
    expect(result.wikiNeighborhood.inLinks.map((page) => page.slug)).toEqual([
      "stances/platform-shape",
    ]);
    expect(result.wikiNeighborhood.outLinks.map((page) => page.slug)).toEqual([
      "heuristics/reuse-before-new",
    ]);
    expect(result.wikiNeighborhood.stancesAndHeuristics.map((page) => page.pageKind)).toEqual([
      "stance",
      "heuristic",
    ]);
    expect(result.sources.map((source) => source.id)).toEqual(["RS-1"]);
    expect(result.priorDecisions.map((decision) => decision.interactionId)).toEqual([
      "DI-1",
    ]);
  });

  it("returns a stable shape for profile material without a wiki page", async () => {
    const db = makeDb({
      perspectiveMaterial: {
        findUnique: vi.fn().mockResolvedValue({
          materialId: "PM-2",
          profileId: "profile-org",
          sourceType: "policy",
          sourceRef: {},
          summary: "Comp customers after missed appointments.",
          domainClass: "risk-assessment",
          direction: "support",
          reviewStatus: "approved",
          promotionState: "promoted",
        }),
      },
      wikiPage: {
        findFirst: vi.fn().mockResolvedValue(null),
      },
      wikiPageLink: {
        findMany: vi.fn(),
      },
      wikiPageSource: {
        findMany: vi.fn(),
      },
      decisionInteraction: {
        findMany: vi.fn().mockResolvedValue([]),
      },
    });

    const result = await getMaterialBacklinks({
      db,
      target: { materialId: "PM-2" },
    });

    expect(result.missingReason).toBe("none");
    expect(result.material.materialId).toBe("PM-2");
    expect(result.material.wikiPageId).toBeNull();
    expect(result.wikiNeighborhood.page).toBeNull();
    expect(result.wikiNeighborhood.inLinks).toEqual([]);
    expect(db.wikiPageLink?.findMany).not.toHaveBeenCalled();
    expect(db.wikiPageSource?.findMany).not.toHaveBeenCalled();
  });

  it("reports missing material when a material id does not resolve", async () => {
    const result = await getMaterialBacklinks({
      db: makeDb({
        perspectiveMaterial: {
          findUnique: vi.fn().mockResolvedValue(null),
        },
      }),
      target: { materialId: "PM-missing" },
    });

    expect(result.missingReason).toBe("material-not-found");
    expect(result.material.materialId).toBeNull();
  });

  it("reports missing wiki page when a page target does not resolve", async () => {
    const db = makeDb({
      wikiPage: {
        findFirst: vi.fn().mockResolvedValue(null),
      },
    });
    delete db.perspectiveMaterial;

    const result = await getMaterialBacklinks({
      db,
      target: { slug: "principles/missing" },
    });

    expect(result.missingReason).toBe("wiki-page-not-found");
  });

  it("reports no target when nothing is supplied", async () => {
    const result = await getMaterialBacklinks({
      db: makeDb(),
      target: {},
    });

    expect(result.missingReason).toBe("no-target");
  });

  it("enforces caps for linked pages and source citations", async () => {
    const incoming = Array.from({ length: 3 }, (_, index) => ({
      fromPageId: `WP-IN-${index}`,
      toPageId: "WP-1",
      fromPage: {
        id: `WP-IN-${index}`,
        slug: `stances/${index}`,
        title: `Stance ${index}`,
        pageKind: "stance",
        status: "published",
        isKernel: true,
      },
    }));
    const outgoing = Array.from({ length: 3 }, (_, index) => ({
      fromPageId: "WP-1",
      toPageId: `WP-OUT-${index}`,
      toPage: {
        id: `WP-OUT-${index}`,
        slug: `heuristics/${index}`,
        title: `Heuristic ${index}`,
        pageKind: "heuristic",
        status: "published",
        isKernel: true,
      },
    }));

    const result = await getMaterialBacklinks({
      db: makeDb({
        wikiPageLink: {
          findMany: vi
            .fn()
            .mockResolvedValueOnce(incoming)
            .mockResolvedValueOnce(outgoing),
        },
        wikiPageSource: {
          findMany: vi.fn().mockResolvedValue(
            Array.from({ length: 3 }, (_, index) => ({
              pageId: "WP-1",
              sourceId: `RS-${index}`,
              source: {
                id: `RS-${index}`,
                title: `Source ${index}`,
                sourceType: "article",
              },
            })),
          ),
        },
      }),
      target: { materialId: "PM-1" },
      caps: { inLinks: 2, outLinks: 1, sources: 2 },
    });

    expect(result.wikiNeighborhood.inLinks).toHaveLength(2);
    expect(result.wikiNeighborhood.outLinks).toHaveLength(1);
    expect(result.sources).toHaveLength(2);
  });
});
