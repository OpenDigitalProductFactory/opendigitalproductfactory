import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  auth: vi.fn(),
  can: vi.fn(),
  getGraphCensus: vi.fn(),
  expandGraphNeighbourhood: vi.fn(),
  getGraphNodeDetail: vi.fn(),
}));

vi.mock("@/lib/auth", () => ({ auth: mocks.auth }));
vi.mock("@/lib/permissions", () => ({ can: mocks.can }));
vi.mock("@/lib/graph/explorer-queries", () => ({
  getGraphCensus: mocks.getGraphCensus,
  expandGraphNeighbourhood: mocks.expandGraphNeighbourhood,
  getGraphNodeDetail: mocks.getGraphNodeDetail,
}));

import { GET } from "./route";

beforeEach(() => {
  vi.resetAllMocks();
  mocks.auth.mockResolvedValue({
    user: { platformRole: "admin", isSuperuser: false },
  });
  mocks.can.mockReturnValue(true);
  mocks.getGraphCensus.mockResolvedValue({
    labels: [{ label: "DataModel", count: 3 }],
    relTypes: [{ relType: "USES", count: 2 }],
    nodeTotal: 3,
    edgeTotal: 2,
  });
  mocks.expandGraphNeighbourhood.mockResolvedValue({
    nodes: [{ key: "node-1" }],
    edges: [],
    truncated: false,
    notice: null,
  });
  mocks.getGraphNodeDetail.mockResolvedValue({ key: "node-1" });
});

describe("GET /api/admin/graph-explorer/purpose-state", () => {
  it("resolves the initial populated-corpus state independently", async () => {
    const response = await GET();

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      schemaVersion: 1,
      routePath: "/admin/graph-explorer",
      stateKey: "no-starting-point",
      oracleKey: "route-owned-read-model",
      sourceRef: "apps/web/lib/graph/explorer-queries.ts#getGraphCensus",
    });
  });

  it("resolves an empty graph without relying on DOM markers", async () => {
    mocks.getGraphCensus.mockResolvedValue({
      labels: [],
      relTypes: [],
      nodeTotal: 0,
      edgeTotal: 0,
    });

    const response = await GET();
    expect(await response.json()).toMatchObject({ stateKey: "empty-corpus" });
  });

  it("independently validates a loaded and inspected neighbourhood", async () => {
    const response = await GET(
      new Request(
        "http://localhost/api/admin/graph-explorer/purpose-state?seed=node-1&inspected=node-1&depth=1",
      ),
    );

    expect(await response.json()).toMatchObject({
      stateKey: "neighbourhood-drawn",
      sourceRef: "apps/web/lib/graph/explorer-queries.ts#expandGraphNeighbourhood",
    });
    expect(mocks.expandGraphNeighbourhood).toHaveBeenCalledWith({
      seedKeys: ["node-1"],
      depth: 1,
    });
    expect(mocks.getGraphNodeDetail).toHaveBeenCalledWith("node-1");
  });

  it("does not trust an inspected key absent from the resolved neighbourhood", async () => {
    mocks.expandGraphNeighbourhood.mockResolvedValue({
      nodes: [{ key: "another-node" }],
      edges: [],
      truncated: false,
      notice: null,
    });

    const response = await GET(
      new Request(
        "http://localhost/api/admin/graph-explorer/purpose-state?seed=node-1&inspected=node-1",
      ),
    );
    expect(await response.json()).toMatchObject({ stateKey: "no-starting-point" });
  });

  it("fails closed before reading the graph when unauthenticated", async () => {
    mocks.auth.mockResolvedValue(null);

    const response = await GET();
    expect(response.status).toBe(401);
    expect(mocks.getGraphCensus).not.toHaveBeenCalled();
  });

  it("requires view_admin", async () => {
    mocks.can.mockReturnValue(false);

    const response = await GET();
    expect(response.status).toBe(403);
    expect(mocks.getGraphCensus).not.toHaveBeenCalled();
  });
});
