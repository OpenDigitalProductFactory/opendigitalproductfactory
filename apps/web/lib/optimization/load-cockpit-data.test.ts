// Loader tests for the optimization cockpit (BI-D9B58004). All dependencies
// are injected, so these exercise the aggregation + degradation logic without
// a graph store or database.

import { describe, expect, it } from "vitest";

import { CONSOLIDATION_BETS } from "./consolidation-bets";
import { loadOptimizationCockpitData, type CockpitLoaderDeps } from "./load-cockpit-data";

const BASE_FRESHNESS = {
  graphKey: "source-code",
  available: true,
  indexStatus: "ready",
  lastIndexedAt: new Date("2026-07-09T00:00:00Z"),
  lastIndexedBranch: "main",
  lastIndexedHeadSha: "abc",
  workspaceDirty: false,
  indexedFileCount: 4406,
  lastError: null,
  warnings: [],
  summary: "Code graph is ready.",
};

function makeDeps(overrides: Partial<CockpitLoaderDeps> = {}): CockpitLoaderDeps {
  return {
    getFreshness: async () => ({ ...BASE_FRESHNESS }),
    trace: async (input) => ({
      graphKey: "source-code",
      available: true,
      indexStatus: "ready",
      warnings: [],
      summary: "ok",
      selector: input.model
        ? { kind: "model" as const, value: input.model }
        : input.tool
          ? { kind: "tool" as const, value: input.tool }
          : { kind: "route" as const, value: input.route ?? "" },
      surface: {
        kind: "PrismaModel" as never,
        name: input.model ?? input.tool ?? input.route ?? "",
        path: "packages/db/prisma/schema.prisma",
        startLine: 1,
        endLine: 2,
      },
      implementationFiles: [
        { path: `impl/${input.model ?? input.tool}.ts`, relationship: "DEFINES" },
        { path: "impl/shared.ts", relationship: "DEFINES" },
      ],
      relatedTests: [{ path: `impl/${input.model ?? input.tool}.test.ts`, confidence: "high" as never }],
    }),
    coverage: async (files) => ({
      graphKey: "source-code",
      available: true,
      indexStatus: "ready",
      indexedFiles: files.slice(0, 1),
      unindexedFiles: files.slice(1),
      warnings: [],
      summary: "ok",
    }),
    findBacklogItems: async (itemIds) =>
      itemIds.map((itemId, index) => ({
        itemId,
        status: index === 0 ? "done" : "open",
        title: `Item ${itemId}`,
      })),
    ...overrides,
  };
}

describe("loadOptimizationCockpitData", () => {
  it("projects every registered bet with blast radius and live status", async () => {
    const data = await loadOptimizationCockpitData(makeDeps());

    expect(data.bets).toHaveLength(CONSOLIDATION_BETS.length);
    expect(data.freshness.available).toBe(true);
    expect(data.totals.betCount).toBe(CONSOLIDATION_BETS.length);
    expect(data.totals.backlogDone).toBeGreaterThan(0);

    const bet1 = data.bets.find((projection) => projection.bet.betKey === "BET-1");
    expect(bet1).toBeDefined();
    // 7 model selectors, each tracing 2 impl files (1 shared) -> 8 distinct.
    expect(bet1?.blastRadius?.tracedSelectorCount).toBe(7);
    expect(bet1?.blastRadius?.implementationFileCount).toBe(8);
    expect(bet1?.blastRadius?.unresolvedSelectors).toEqual([]);
    expect(bet1?.fileCoverage?.indexedCount).toBe(1);
    expect(bet1?.fileCoverage?.unindexedCount).toBe(bet1!.bet.selectors.files.length - 1);
  });

  it("degrades to null projections when the graph is unavailable", async () => {
    const deps = makeDeps({
      getFreshness: async () => ({
        ...BASE_FRESHNESS,
        available: false,
        indexStatus: "missing",
        warnings: ["The code graph has not been built yet."],
        summary: "The code graph has not been built yet.",
      }),
      trace: async () => {
        throw new Error("must not trace when unavailable");
      },
      coverage: async () => {
        throw new Error("must not summarize when unavailable");
      },
    });

    const data = await loadOptimizationCockpitData(deps);
    expect(data.freshness.available).toBe(false);
    for (const projection of data.bets) {
      expect(projection.blastRadius).toBeNull();
      expect(projection.fileCoverage).toBeNull();
      expect(projection.backlogItems.length).toBeGreaterThan(0);
    }
    expect(data.totals.implementationFileCount).toBe(0);
  });

  it("treats per-selector graph errors as unresolved instead of failing the page", async () => {
    const deps = makeDeps({
      trace: async (input) => {
        if (input.model === "TaskRun") throw new Error("neo4j hiccup");
        return {
          graphKey: "source-code",
          available: true,
          indexStatus: "ready",
          warnings: [],
          summary: "ok",
          selector: { kind: "model" as const, value: input.model ?? input.tool ?? "" },
          surface: null,
          implementationFiles: [],
          relatedTests: [],
        };
      },
      coverage: async () => {
        throw new Error("coverage down");
      },
    });

    const data = await loadOptimizationCockpitData(deps);
    const bet10 = data.bets.find((projection) => projection.bet.betKey === "BET-10");
    expect(bet10?.blastRadius?.unresolvedSelectors).toContain("model:TaskRun");
    expect(bet10?.fileCoverage).toBeNull();
  });

  it("marks missing backlog rows with null status", async () => {
    const deps = makeDeps({ findBacklogItems: async () => [] });
    const data = await loadOptimizationCockpitData(deps);
    for (const projection of data.bets) {
      for (const item of projection.backlogItems) {
        expect(item.status).toBeNull();
      }
    }
  });
});
