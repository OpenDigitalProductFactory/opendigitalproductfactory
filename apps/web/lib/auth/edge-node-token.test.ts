import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@dpf/db", () => ({
  prisma: {
    edgeNode: {
      findUnique: vi.fn(),
    },
  },
}));

import { prisma } from "@dpf/db";

import { resolveEdgeNodeAuth } from "./edge-node-token";

const findUnique = prisma.edgeNode.findUnique as unknown as ReturnType<
  typeof vi.fn
>;

const ACTIVE_TRUSTED_NODE = {
  id: "edgenode_cuid_1",
  nodeId: "edge_a1b2c3",
  displayName: "Test",
  platform: "linux",
  installMode: "container-host",
  version: "0.1.0",
  status: "active",
  trustState: "trusted",
  lastSeenAt: new Date(),
  capabilities: ["discovery.network"],
  metadata: null,
  customerAccountId: "cust_acme",
  customerSiteId: "site_hq",
  scopePolicy: {
    ownershipScope: "customer-site",
    enforcement: "strict-customer-scope",
    source: "bootstrap-token",
    customerAccountId: "cust_acme",
    customerSiteId: "site_hq",
  },
  tokenHash: "hashed",
  tokenPrefix: "dpfedge_xyz",
  tokenRotatedAt: new Date(),
  enrolledAt: new Date(),
  approvedAt: new Date(),
  approvedByPrincipalId: "principal_1",
  quarantinedAt: null,
  quarantineReason: null,
  revokedAt: null,
  revocationReason: null,
  createdAt: new Date(),
  updatedAt: new Date(),
};

beforeEach(() => {
  vi.resetAllMocks();
});

describe("resolveEdgeNodeAuth — header parsing", () => {
  it("rejects missing Authorization", async () => {
    const r = await resolveEdgeNodeAuth(null, "edge:heartbeat");
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toBe("missing_authorization");
  });

  it("rejects empty Authorization", async () => {
    const r = await resolveEdgeNodeAuth(undefined, "edge:heartbeat");
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toBe("missing_authorization");
  });

  it("rejects non-Bearer scheme", async () => {
    const r = await resolveEdgeNodeAuth("Basic abc123", "edge:heartbeat");
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toBe("invalid_scheme");
  });

  it("rejects Bearer with empty token", async () => {
    const r = await resolveEdgeNodeAuth("Bearer    ", "edge:heartbeat");
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toBe("invalid_scheme");
  });

  it("rejects wrong token prefix (refuses to query DB)", async () => {
    const r = await resolveEdgeNodeAuth(
      "Bearer dpfmcp_ABCDEFG",
      "edge:heartbeat",
    );
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toBe("invalid_token_format");
    expect(findUnique).not.toHaveBeenCalled();
  });
});

describe("resolveEdgeNodeAuth — token resolution", () => {
  it("rejects unknown token", async () => {
    findUnique.mockResolvedValueOnce(null);
    const r = await resolveEdgeNodeAuth(
      "Bearer dpfedge_DOESNOTEXIST",
      "edge:heartbeat",
    );
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toBe("token_not_found");
  });

  it("accepts a trusted node for heartbeat scope", async () => {
    findUnique.mockResolvedValueOnce(ACTIVE_TRUSTED_NODE);
    const r = await resolveEdgeNodeAuth(
      "Bearer dpfedge_ABCDEFGHIJKL",
      "edge:heartbeat",
    );
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.edgeNodeRowId).toBe("edgenode_cuid_1");
      expect(r.nodeId).toBe("edge_a1b2c3");
      expect(r.trustState).toBe("trusted");
      expect(r.customerAccountId).toBe("cust_acme");
      expect(r.customerSiteId).toBe("site_hq");
      expect(r.scopePolicy).toMatchObject({
        ownershipScope: "customer-site",
        enforcement: "strict-customer-scope",
      });
    }
  });

  it("accepts a pending node for heartbeat scope (so operator sees it)", async () => {
    findUnique.mockResolvedValueOnce({
      ...ACTIVE_TRUSTED_NODE,
      trustState: "pending",
      status: "pending",
      approvedAt: null,
      approvedByPrincipalId: null,
    });
    const r = await resolveEdgeNodeAuth(
      "Bearer dpfedge_PENDING",
      "edge:heartbeat",
    );
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.trustState).toBe("pending");
  });

  it("rejects a revoked node", async () => {
    findUnique.mockResolvedValueOnce({
      ...ACTIVE_TRUSTED_NODE,
      trustState: "revoked",
      revokedAt: new Date(),
      revocationReason: "operator_revoked",
    });
    const r = await resolveEdgeNodeAuth(
      "Bearer dpfedge_REVOKED",
      "edge:heartbeat",
    );
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toBe("node_revoked");
  });

  it("rejects a node with revokedAt set even if trustState lags", async () => {
    findUnique.mockResolvedValueOnce({
      ...ACTIVE_TRUSTED_NODE,
      revokedAt: new Date(),
    });
    const r = await resolveEdgeNodeAuth(
      "Bearer dpfedge_LAGGING",
      "edge:heartbeat",
    );
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toBe("node_revoked");
  });

  it("rejects a node with no tokenHash (defensive — should never happen post-enroll)", async () => {
    findUnique.mockResolvedValueOnce({
      ...ACTIVE_TRUSTED_NODE,
      tokenHash: null,
    });
    const r = await resolveEdgeNodeAuth(
      "Bearer dpfedge_NOHASH",
      "edge:heartbeat",
    );
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toBe("node_revoked");
  });
});

describe("resolveEdgeNodeAuth — scope refinement", () => {
  it("trusted node may submit observations", async () => {
    findUnique.mockResolvedValueOnce(ACTIVE_TRUSTED_NODE);
    const r = await resolveEdgeNodeAuth(
      "Bearer dpfedge_TRUSTED",
      "discovery:submit",
    );
    expect(r.ok).toBe(true);
  });

  it("pending node CANNOT submit observations (heartbeat ok, submit not)", async () => {
    findUnique.mockResolvedValueOnce({
      ...ACTIVE_TRUSTED_NODE,
      trustState: "pending",
    });
    const r = await resolveEdgeNodeAuth(
      "Bearer dpfedge_PENDING",
      "discovery:submit",
    );
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toBe("scope_disallowed");
  });

  it("quarantined node CANNOT submit observations (route-layer enforcement)", async () => {
    findUnique.mockResolvedValueOnce({
      ...ACTIVE_TRUSTED_NODE,
      trustState: "quarantined",
      quarantinedAt: new Date(),
      quarantineReason: "anomaly",
    });
    const r = await resolveEdgeNodeAuth(
      "Bearer dpfedge_QUAR",
      "discovery:submit",
    );
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toBe("scope_disallowed");
  });

  it("quarantined node MAY heartbeat (so operator sees it's alive)", async () => {
    findUnique.mockResolvedValueOnce({
      ...ACTIVE_TRUSTED_NODE,
      trustState: "quarantined",
      quarantinedAt: new Date(),
      quarantineReason: "anomaly",
    });
    const r = await resolveEdgeNodeAuth(
      "Bearer dpfedge_QUAR",
      "edge:heartbeat",
    );
    expect(r.ok).toBe(true);
  });
});
