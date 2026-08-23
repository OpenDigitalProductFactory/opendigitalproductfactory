// BI-86EF5900: an EMPTY graph must not be able to present as healthy.
//
// Live measurement 2026-08-23: CodeGraphFileHash held 4406 rows while
// graph_node/graph_edge for that graphKey held ZERO, and the tool reported
// indexStatus "ready" for "4406 indexed files". indexedFileCount reads a
// different table than the graph, so it cannot fall when the graph empties.
import { describe, it, expect } from "vitest";

import { buildCodeGraphFreshnessTrust } from "./code-graph";

const READY = {
  graphKey: "source-code",
  available: true,
  indexStatus: "ready",
  lastIndexedAt: new Date().toISOString(),
  workspaceDirty: false,
  indexedFileCount: 4406,
  lastError: null,
  lastIndexedBranch: "main",
};

describe("code-graph trust — graph population", () => {
  it("scores an empty graph at zero coverage even when 4406 files are 'indexed'", () => {
    const trust = buildCodeGraphFreshnessTrust({ ...READY, nodeCount: 0, edgeCount: 0 });
    const coverage = trust.dimensions.find((d) => d.label === "Graph population");
    expect(coverage?.score).toBe(0);
    expect(coverage?.rationale).toMatch(/EMPTY/);
    expect(coverage?.rationale).toMatch(/no evidence of absence/i);
  });

  it("does not let an empty graph present as high trust", () => {
    const trust = buildCodeGraphFreshnessTrust({ ...READY, nodeCount: 0, edgeCount: 0 });
    expect(trust.tier).not.toBe("high");
    expect(["qualify", "warn-stale", "refresh-required", "escalate", "defer"]).toContain(trust.action);
  });

  it("distinguishes a file index (nodes, no edges) from an empty graph", () => {
    const trust = buildCodeGraphFreshnessTrust({ ...READY, nodeCount: 4406, edgeCount: 0 });
    const coverage = trust.dimensions.find((d) => d.label === "Graph population");
    expect(coverage?.score).toBe(0.35);
    expect(coverage?.rationale).toMatch(/file index, not a graph/);
  });

  it("scores a populated graph at full coverage", () => {
    const trust = buildCodeGraphFreshnessTrust({ ...READY, nodeCount: 4406, edgeCount: 10764 });
    const coverage = trust.dimensions.find((d) => d.label === "Graph population");
    expect(coverage?.score).toBe(1);
  });

  it("reports unknown rather than healthy when population cannot be inspected", () => {
    const trust = buildCodeGraphFreshnessTrust({ ...READY, nodeCount: null, edgeCount: null });
    const coverage = trust.dimensions.find((d) => d.label === "Graph population");
    expect(coverage?.score).toBeNull();
  });
});
