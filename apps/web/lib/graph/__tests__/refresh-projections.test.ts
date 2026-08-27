import { beforeEach, describe, expect, it, vi } from "vitest";

// BI-FEDFABF6: these projections had no invoker, so the domains they maintain read
// as empty while the code graph — which has an indexer — stayed full. Boot now calls
// them. The properties worth pinning are not "it projects" (the projections have
// their own tests) but the two that make a BOOT caller safe.

const {
  clearGraphByLabel,
  countDocPagesInManifest,
  hasProjectionFault,
  projectDocImpactManifest,
  rebuildKnowledgeAndPortfolioGraph,
  reconcileGraphProjections,
} = vi.hoisted(() => ({
  clearGraphByLabel: vi.fn(),
  countDocPagesInManifest: vi.fn(),
  hasProjectionFault: vi.fn(),
  projectDocImpactManifest: vi.fn(),
  rebuildKnowledgeAndPortfolioGraph: vi.fn(),
  reconcileGraphProjections: vi.fn(),
}));

vi.mock("@dpf/db", () => ({
  clearGraphByLabel,
  countDocPagesInManifest,
  DOC_PAGE_LABEL: "DocPage",
  hasProjectionFault,
  projectDocImpactManifest,
  rebuildKnowledgeAndPortfolioGraph,
  reconcileGraphProjections,
}));

import { refreshGraphProjections } from "../refresh-projections";

beforeEach(() => {
  vi.clearAllMocks();
  vi.spyOn(console, "error").mockImplementation(() => {});
  clearGraphByLabel.mockResolvedValue(undefined);
  projectDocImpactManifest.mockResolvedValue({ nodes: 183, edges: 616 });
  rebuildKnowledgeAndPortfolioGraph.mockResolvedValue(undefined);
  countDocPagesInManifest.mockReturnValue(198);
  reconcileGraphProjections.mockResolvedValue(HEALTHY);
  hasProjectionFault.mockReturnValue(false);
});

const HEALTHY = [
  { projectionKey: "knowledge", describes: "", mirrorCount: 354, sourceCount: 354, drift: 0, status: "ok" },
];

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

// BI-A73954F7 — reconciliation. Every failure in this class was found by a HUMAN
// comparing mirror counts to source-of-truth counts; nothing did it automatically.
describe("refreshGraphProjections reconciliation", () => {
  it("reconciles AFTER refreshing and returns the result", async () => {
    // Order matters: reconciling before the refresh would measure the mirror the
    // refresh is about to replace and report drift that no longer exists.
    const result = await refreshGraphProjections();

    expect(reconcileGraphProjections).toHaveBeenCalledTimes(1);
    expect(rebuildKnowledgeAndPortfolioGraph).toHaveBeenCalledBefore(reconcileGraphProjections);
    expect(result.reconciliation).toEqual(HEALTHY);
  });

  it("derives the doc source count from the manifest rather than assuming a shape", async () => {
    // An earlier revision read `manifest.pages.length`. That key does not exist, so
    // the count was `undefined`, the invariant was SILENTLY SKIPPED, and doc-impact
    // went unchecked — the exact silent-skip this whole item exists to remove.
    await refreshGraphProjections();

    expect(countDocPagesInManifest).toHaveBeenCalledTimes(1);
    expect(reconcileGraphProjections).toHaveBeenCalledWith({ docManifestPageCount: 198 });
  });

  it("reports loudly when the mirror does not match its source", async () => {
    const faulted = [
      { projectionKey: "portfolio", describes: "", mirrorCount: 0, sourceCount: 765, drift: -765, status: "empty" },
    ];
    reconcileGraphProjections.mockResolvedValue(faulted);
    hasProjectionFault.mockReturnValue(true);
    const error = vi.spyOn(console, "error").mockImplementation(() => {});

    const result = await refreshGraphProjections();

    expect(result.reconciliation).toEqual(faulted);
    // The counts must be IN the message: "portfolio is empty" is not actionable
    // without knowing the source had 765 rows to project.
    const logged = error.mock.calls.map((c) => c.join(" ")).join(" | ");
    expect(logged).toContain("portfolio=0/765");
    expect(logged).toContain("empty");
  });

  it("stays silent when every projection matches", async () => {
    const error = vi.spyOn(console, "error").mockImplementation(() => {});

    await refreshGraphProjections();

    // Assert the check RAN before asserting it stayed quiet — otherwise this passes
    // just as happily when reconciliation is absent entirely, which is the vacuous
    // shape that has bitten this work repeatedly.
    expect(reconcileGraphProjections).toHaveBeenCalledTimes(1);
    expect(hasProjectionFault).toHaveBeenCalledWith(HEALTHY);
    const logged = error.mock.calls.map((c) => c.join(" ")).join(" | ");
    expect(logged).not.toContain("DOES NOT MATCH");
  });

  it("still returns a refresh result when reconciliation itself fails", async () => {
    // Observability must never be able to wedge boot or mask a successful refresh.
    reconcileGraphProjections.mockRejectedValue(new Error("db down"));

    const result = await refreshGraphProjections();

    // Same reason: without this call assertion the test passes when reconciliation
    // was never attempted, proving nothing about resilience.
    expect(reconcileGraphProjections).toHaveBeenCalledTimes(1);
    expect(result.knowledgeAndPortfolio).toBe("ok");
    expect(result.reconciliation).toBeUndefined();
  });
});
