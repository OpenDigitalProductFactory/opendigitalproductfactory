import { beforeEach, describe, expect, it, vi } from "vitest";

const {
  getNetworkTopologyAtLayerForScopeMock,
  getNetworkTopologyAtLayerMock,
} = vi.hoisted(() => ({
  getNetworkTopologyAtLayerForScopeMock: vi.fn(),
  getNetworkTopologyAtLayerMock: vi.fn(),
}));

vi.mock("@dpf/db", () => ({
  getNeighbours: vi.fn(),
  getInfraCIs: vi.fn().mockResolvedValue([]),
  getDownstreamImpact: vi.fn(),
  getLayeredDependencyStack: vi.fn(),
  getNetworkTopologyAtLayer: getNetworkTopologyAtLayerMock,
  getNetworkTopologyAtLayerForScope: getNetworkTopologyAtLayerForScopeMock,
  buildDiscoveryScopeKey: (scope: {
    mode: string;
    customerAccountId?: string;
    customerSiteId?: string;
  }) => {
    if (scope.mode === "organization-internal") return "organization:internal";
    if (scope.mode === "customer-account") return `customer:${scope.customerAccountId}`;
    return `customer:${scope.customerAccountId}:site:${scope.customerSiteId}`;
  },
  scopeFieldsFromContext: (scope: {
    mode: string;
    customerAccountId?: string;
    customerSiteId?: string;
  }) => ({
    scopeKey:
      scope.mode === "organization-internal"
        ? "organization:internal"
        : scope.mode === "customer-account"
          ? `customer:${scope.customerAccountId}`
          : `customer:${scope.customerAccountId}:site:${scope.customerSiteId}`,
    customerAccountId: scope.customerAccountId ?? null,
    customerSiteId: scope.customerSiteId ?? null,
  }),
  runCypher: vi.fn().mockResolvedValue([]),
  prisma: {
    digitalProduct: { findMany: vi.fn().mockResolvedValue([]), findUnique: vi.fn().mockResolvedValue(null) },
    portfolio: { findMany: vi.fn().mockResolvedValue([]) },
    taxonomyNode: { findMany: vi.fn().mockResolvedValue([]) },
  },
}));

import { getCustomerNetworkTopologyData } from "./graph";

describe("getCustomerNetworkTopologyData", () => {
  beforeEach(() => {
    getNetworkTopologyAtLayerForScopeMock.mockReset();
    getNetworkTopologyAtLayerForScopeMock.mockResolvedValue({ nodes: [], edges: [] });
    getNetworkTopologyAtLayerMock.mockReset();
    getNetworkTopologyAtLayerMock.mockResolvedValue({ nodes: [], edges: [] });
  });

  it("uses the scoped Neo4j query for customer-site topology", async () => {
    await getCustomerNetworkTopologyData({
      mode: "customer-site",
      customerAccountId: "cust_a",
      customerSiteId: "site_austin",
    });

    expect(getNetworkTopologyAtLayerForScopeMock).toHaveBeenCalledWith(3, {
      scopeKey: "customer:cust_a:site:site_austin",
      customerAccountId: "cust_a",
      customerSiteId: "site_austin",
    });
    expect(getNetworkTopologyAtLayerMock).not.toHaveBeenCalled();
  });

  it("uses the scoped Neo4j query for customer-account topology", async () => {
    await getCustomerNetworkTopologyData({
      mode: "customer-account",
      customerAccountId: "cust_a",
    });

    expect(getNetworkTopologyAtLayerForScopeMock).toHaveBeenCalledWith(3, {
      scopeKey: "customer:cust_a",
      customerAccountId: "cust_a",
      customerSiteId: null,
    });
  });

  it("falls back to the unscoped query only for organization-internal scope", async () => {
    await getCustomerNetworkTopologyData({ mode: "organization-internal" });

    expect(getNetworkTopologyAtLayerForScopeMock).not.toHaveBeenCalled();
  });
});
