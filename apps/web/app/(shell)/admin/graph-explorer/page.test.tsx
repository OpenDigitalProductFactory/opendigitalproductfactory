import { describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  getGraphCensus: vi.fn(),
}));

vi.mock("@/lib/graph/explorer-queries", () => ({
  getGraphCensus: mocks.getGraphCensus,
}));
vi.mock("@/components/admin/GraphExplorer", () => ({
  GraphExplorer: () => null,
}));

import GraphExplorerPage from "./page";

describe("GraphExplorerPage", () => {
  it("passes one bounded URL context into the interactive explorer", async () => {
    const census = { labels: [], relTypes: [], nodeTotal: 12, edgeTotal: 4 };
    mocks.getGraphCensus.mockResolvedValue(census);

    const element = await GraphExplorerPage({
      searchParams: Promise.resolve({
        seed: Array.from({ length: 12 }, (_, index) => `node-${index}`),
        depth: "3",
        inspected: "node-4",
      }),
    });

    expect(element.props.census).toBe(census);
    expect(element.props.initialPurposeContext).toEqual({
      seedKeys: Array.from({ length: 10 }, (_, index) => `node-${index}`),
      depth: 3,
      inspectedKey: "node-4",
    });
  });
});
