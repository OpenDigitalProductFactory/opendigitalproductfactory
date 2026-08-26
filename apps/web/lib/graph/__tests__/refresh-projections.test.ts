import { beforeEach, describe, expect, it, vi } from "vitest";

// BI-FEDFABF6: these projections had no invoker, so the domains they maintain read
// as empty while the code graph — which has an indexer — stayed full. Boot now calls
// them. The properties worth pinning are not "it projects" (the projections have
// their own tests) but the two that make a BOOT caller safe.

const { clearGraphByLabel, projectDocImpactManifest, rebuildKnowledgeAndPortfolioGraph } =
  vi.hoisted(() => ({
    clearGraphByLabel: vi.fn(),
    projectDocImpactManifest: vi.fn(),
    rebuildKnowledgeAndPortfolioGraph: vi.fn(),
  }));

vi.mock("@dpf/db", () => ({
  clearGraphByLabel,
  DOC_PAGE_LABEL: "DocPage",
  projectDocImpactManifest,
  rebuildKnowledgeAndPortfolioGraph,
}));

import { refreshGraphProjections } from "../refresh-projections";

beforeEach(() => {
  vi.clearAllMocks();
  vi.spyOn(console, "error").mockImplementation(() => {});
  clearGraphByLabel.mockResolvedValue(undefined);
  projectDocImpactManifest.mockResolvedValue({ nodes: 183, edges: 616 });
  rebuildKnowledgeAndPortfolioGraph.mockResolvedValue(undefined);
});

describe("refreshGraphProjections", () => {
  it("refreshes every projection that has no indexer of its own", async () => {
    const result = await refreshGraphProjections();

    expect(projectDocImpactManifest).toHaveBeenCalledTimes(1);
    expect(rebuildKnowledgeAndPortfolioGraph).toHaveBeenCalledTimes(1);
    expect(result.docImpact).toEqual({ nodes: 183, edges: 616 });
    expect(result.knowledgeAndPortfolio).toBe("ok");
  });

  it("clears ONLY the label doc-impact owns before projecting", async () => {
    // Clearing a shared label (CodeFile) would delete the code graph's own nodes and
    // their IMPORTS/TESTED_BY edges. Every IMPACTS edge ends at a DocPage, so DocPage
    // is the one safe clear (BI-EC5FF1A0).
    await refreshGraphProjections();

    expect(clearGraphByLabel).toHaveBeenCalledTimes(1);
    expect(clearGraphByLabel).toHaveBeenCalledWith("DocPage");
  });

  it("isolates a failing projection so the others still refresh", async () => {
    // A partially-current mirror beats one that stopped at the first error.
    projectDocImpactManifest.mockRejectedValue(new Error("manifest unreadable"));

    const result = await refreshGraphProjections();

    expect(result.docImpact).toEqual({ error: "manifest unreadable" });
    expect(rebuildKnowledgeAndPortfolioGraph).toHaveBeenCalledTimes(1);
    expect(result.knowledgeAndPortfolio).toBe("ok");
  });

  it("never throws, so it cannot wedge portal boot", async () => {
    // This runs inside instrumentation.register(). A throw here would take the portal
    // down over a stale graph, which is a strictly worse trade.
    clearGraphByLabel.mockRejectedValue(new Error("db down"));
    rebuildKnowledgeAndPortfolioGraph.mockRejectedValue(new Error("db down"));

    await expect(refreshGraphProjections()).resolves.toMatchObject({
      docImpact: { error: "db down" },
      knowledgeAndPortfolio: { error: "db down" },
    });
  });
});
