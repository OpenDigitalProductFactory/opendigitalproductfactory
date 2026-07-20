import { describe, expect, it } from "vitest";

import type { BootstrapToken, EdgeNode } from "./edge-node-types";
import {
  BOOTSTRAP_TOKEN_DEFAULT_TTL_MS,
  BOOTSTRAP_TOKEN_MAX_TTL_MS,
  BOOTSTRAP_TOKEN_PREFIX,
  EDGE_NODE_ALIAS_KIND,
  EDGE_NODE_CAPABILITY_MODES,
  EDGE_NODE_CAPABILITY_STATUSES,
  EDGE_NODE_INSTALL_MODES,
  EDGE_NODE_PLATFORMS,
  EDGE_NODE_STATUSES,
  EDGE_NODE_TOKEN_PREFIX,
  EDGE_NODE_TRUST_STATES,
  NODE_TOKEN_DEFAULT_TTL_MS,
  PHASE_0_CAPABILITIES,
  RESERVED_CAPABILITIES,
  canEdgeNodeAuthenticateRequest,
  canEdgeNodeSubmitObservations,
  isBootstrapTokenConsumed,
  isBootstrapTokenUsable,
  isEdgeNodeApprovalConsistent,
  isEdgeNodeRevocationConsistent,
} from "./edge-node-types";

// ── Fixture helpers ──────────────────────────────────────────────────────────

function makeNode(overrides: Partial<EdgeNode> = {}): EdgeNode {
  const now = new Date("2026-05-12T12:00:00Z");
  return {
    id: "edgenode_cuid_1",
    // Per AGENTS.md §11 Principal convergence, EdgeNode is keyed 1:1
    // to Principal via principalId. displayName lives on Principal.
    principalId: "principal_cuid_1",
    nodeId: "edge_a1b2c3",
    platform: "linux",
    installMode: "container-host",
    version: "0.1.0",
    status: "pending",
    trustState: "pending",
    lastSeenAt: null,
    capabilities: ["discovery.network"],
    metadata: null,
    customerAccountId: null,
    customerSiteId: null,
    subscriptionId: null,
    scopePolicy: null,
    tokenHash: null,
    tokenPrefix: null,
    tokenRotatedAt: null,
    enrolledAt: null,
    approvedAt: null,
    approvedByPrincipalId: null,
    quarantinedAt: null,
    quarantineReason: null,
    revokedAt: null,
    revocationReason: null,
    createdAt: now,
    updatedAt: now,
    ...overrides,
  };
}

function makeToken(overrides: Partial<BootstrapToken> = {}): BootstrapToken {
  const now = new Date("2026-05-12T12:00:00Z");
  return {
    id: "btok_cuid_1",
    tokenHash: "hashedtoken",
    prefix: "abcdef12",
    scope: "edge:enroll",
    issuedAt: now,
    issuedByPrincipalId: "principal_user_1",
    expiresAt: new Date(now.getTime() + 15 * 60 * 1000),
    consumedAt: null,
    consumedByEdgeNodeId: null,
    revokedAt: null,
    targetCustomerAccountId: null,
    targetCustomerSiteId: null,
    scopePolicy: null,
    // Paste-provisioned default per spec § Approval policy. Tests that
    // care about the auto-approve path override via `overrides`.
    autoApprove: false,
    ...overrides,
  };
}

// ── Constants ────────────────────────────────────────────────────────────────

describe("edge-node-types — constants", () => {
  it("EDGE_NODE_PLATFORMS matches the spec's three values", () => {
    expect(EDGE_NODE_PLATFORMS).toEqual(["darwin", "win32", "linux"]);
  });

  it("EDGE_NODE_INSTALL_MODES matches the spec", () => {
    expect(EDGE_NODE_INSTALL_MODES).toEqual([
      "native",
      "container-host",
      "container-vm",
    ]);
  });

  it("EDGE_NODE_STATUSES + EDGE_NODE_TRUST_STATES are distinct enums per spec", () => {
    // status = operational, trustState = trust lifecycle. The shared
    // value `quarantined` is intentional: a node that's quarantined is
    // also operationally `quarantined` (per spec § Quarantine).
    expect(EDGE_NODE_STATUSES).toContain("active");
    expect(EDGE_NODE_TRUST_STATES).toContain("trusted");
    expect(EDGE_NODE_TRUST_STATES).not.toContain("active");
    expect(EDGE_NODE_STATUSES).not.toContain("trusted");
  });

  it("EDGE_NODE_CAPABILITY_MODES + STATUSES match spec", () => {
    expect(EDGE_NODE_CAPABILITY_MODES).toEqual([
      "enabled",
      "reporting-only",
      "disabled",
    ]);
    expect(EDGE_NODE_CAPABILITY_STATUSES).toEqual([
      "healthy",
      "degraded",
      "failing",
      "unknown",
    ]);
  });

  it("PHASE_0_CAPABILITIES is the strict subset of RESERVED_CAPABILITIES", () => {
    expect(PHASE_0_CAPABILITIES).toEqual(["discovery.network"]);
    for (const cap of PHASE_0_CAPABILITIES) {
      expect(RESERVED_CAPABILITIES).toContain(cap);
    }
    // Other reserved capabilities exist for forward-compat but are not
    // accepted in Phase 0.
    expect(RESERVED_CAPABILITIES.length).toBeGreaterThan(
      PHASE_0_CAPABILITIES.length,
    );
    expect(RESERVED_CAPABILITIES).toContain("federation.discovery");
  });

  it("token prefixes follow the dpf*_ family convention", () => {
    expect(EDGE_NODE_TOKEN_PREFIX).toBe("dpfedge_");
    expect(BOOTSTRAP_TOKEN_PREFIX).toBe("dpfboot_");
  });

  it("bootstrap-token TTL constants enforce the spec's bounds", () => {
    expect(BOOTSTRAP_TOKEN_DEFAULT_TTL_MS).toBe(15 * 60 * 1000);
    expect(BOOTSTRAP_TOKEN_MAX_TTL_MS).toBe(24 * 60 * 60 * 1000);
    expect(BOOTSTRAP_TOKEN_DEFAULT_TTL_MS).toBeLessThan(
      BOOTSTRAP_TOKEN_MAX_TTL_MS,
    );
  });

  it("node-token default TTL aligns with the spec's 24h refresh", () => {
    expect(NODE_TOKEN_DEFAULT_TTL_MS).toBe(24 * 60 * 60 * 1000);
  });

  it("PrincipalAlias kind for EdgeNode identity convergence", () => {
    expect(EDGE_NODE_ALIAS_KIND).toBe("edge_node");
  });
});

// ── BootstrapToken invariants ────────────────────────────────────────────────

describe("isBootstrapTokenConsumed", () => {
  it("false when never consumed", () => {
    expect(isBootstrapTokenConsumed(makeToken())).toBe(false);
  });

  it("true when both consumedAt and consumedByEdgeNodeId are set", () => {
    const t = makeToken({
      consumedAt: new Date(),
      consumedByEdgeNodeId: "edgenode_cuid_1",
    });
    expect(isBootstrapTokenConsumed(t)).toBe(true);
  });

  it("false if only one of the two consumption fields is set (defensive)", () => {
    expect(
      isBootstrapTokenConsumed(makeToken({ consumedAt: new Date() })),
    ).toBe(false);
    expect(
      isBootstrapTokenConsumed(
        makeToken({ consumedByEdgeNodeId: "edgenode_cuid_1" }),
      ),
    ).toBe(false);
  });
});

describe("isBootstrapTokenUsable", () => {
  const now = new Date("2026-05-12T12:00:00Z");

  it("true for a fresh, unconsumed, unrevoked token before expiry", () => {
    expect(isBootstrapTokenUsable(makeToken(), now)).toBe(true);
  });

  it("false once consumed (single-use)", () => {
    expect(
      isBootstrapTokenUsable(
        makeToken({
          consumedAt: now,
          consumedByEdgeNodeId: "edgenode_cuid_1",
        }),
        now,
      ),
    ).toBe(false);
  });

  it("false once revoked", () => {
    expect(
      isBootstrapTokenUsable(makeToken({ revokedAt: now }), now),
    ).toBe(false);
  });

  it("false at exact expiry boundary (>= rule)", () => {
    expect(
      isBootstrapTokenUsable(makeToken({ expiresAt: now }), now),
    ).toBe(false);
  });

  it("false past expiry", () => {
    const past = new Date(now.getTime() - 1000);
    expect(
      isBootstrapTokenUsable(makeToken({ expiresAt: past }), now),
    ).toBe(false);
  });
});

// ── EdgeNode invariants ──────────────────────────────────────────────────────

describe("isEdgeNodeApprovalConsistent", () => {
  it("trusted nodes must have approvedAt", () => {
    expect(
      isEdgeNodeApprovalConsistent(makeNode({ trustState: "trusted" })),
    ).toBe(false);
    expect(
      isEdgeNodeApprovalConsistent(
        makeNode({ trustState: "trusted", approvedAt: new Date() }),
      ),
    ).toBe(true);
  });

  it("non-trusted states are unconstrained by approvedAt", () => {
    for (const state of ["pending", "quarantined", "revoked"] as const) {
      expect(
        isEdgeNodeApprovalConsistent(makeNode({ trustState: state })),
      ).toBe(true);
      expect(
        isEdgeNodeApprovalConsistent(
          makeNode({ trustState: state, approvedAt: new Date() }),
        ),
      ).toBe(true);
    }
  });
});

describe("isEdgeNodeRevocationConsistent", () => {
  it("revoked nodes must have revokedAt", () => {
    expect(
      isEdgeNodeRevocationConsistent(makeNode({ trustState: "revoked" })),
    ).toBe(false);
    expect(
      isEdgeNodeRevocationConsistent(
        makeNode({ trustState: "revoked", revokedAt: new Date() }),
      ),
    ).toBe(true);
  });

  it("non-revoked states unconstrained", () => {
    for (const state of ["pending", "trusted", "quarantined"] as const) {
      expect(
        isEdgeNodeRevocationConsistent(makeNode({ trustState: state })),
      ).toBe(true);
    }
  });
});

describe("canEdgeNodeSubmitObservations", () => {
  it("only trusted nodes may submit", () => {
    expect(
      canEdgeNodeSubmitObservations(makeNode({ trustState: "trusted" })),
    ).toBe(true);
    for (const state of ["pending", "quarantined", "revoked"] as const) {
      expect(
        canEdgeNodeSubmitObservations(makeNode({ trustState: state })),
      ).toBe(false);
    }
  });
});

describe("canEdgeNodeAuthenticateRequest", () => {
  it("requires a tokenHash", () => {
    expect(canEdgeNodeAuthenticateRequest(makeNode())).toBe(false);
  });

  it("works for trusted node with token", () => {
    expect(
      canEdgeNodeAuthenticateRequest(
        makeNode({
          trustState: "trusted",
          tokenHash: "hashed",
          approvedAt: new Date(),
        }),
      ),
    ).toBe(true);
  });

  it("works for pending node with token (so heartbeat works pre-approval)", () => {
    // Important: a pending-trustState node still needs to be able to
    // heartbeat so it shows up in the operator's Edge Nodes list.
    expect(
      canEdgeNodeAuthenticateRequest(
        makeNode({
          trustState: "pending",
          tokenHash: "hashed",
        }),
      ),
    ).toBe(true);
  });

  it("rejects revoked node even with token", () => {
    expect(
      canEdgeNodeAuthenticateRequest(
        makeNode({
          trustState: "revoked",
          tokenHash: "hashed",
          revokedAt: new Date(),
        }),
      ),
    ).toBe(false);
  });

  it("rejects node with revokedAt set even if trustState lags (defensive)", () => {
    expect(
      canEdgeNodeAuthenticateRequest(
        makeNode({
          trustState: "trusted",
          tokenHash: "hashed",
          revokedAt: new Date(),
        }),
      ),
    ).toBe(false);
  });
});
