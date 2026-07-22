import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { mockAuth, mockPrisma, mockIssueBootstrapToken, mockRevalidatePath, mockSyncUserPrincipal } = vi.hoisted(() => ({
  mockAuth: vi.fn(),
  mockPrisma: {
    principalAlias: { findFirst: vi.fn() },
    customerAccount: { findUnique: vi.fn() },
    customerSite: { findFirst: vi.fn() },
    edgeNode: { findUnique: vi.fn(), update: vi.fn() },
    edgeNodeCertificate: { updateMany: vi.fn() },
    $transaction: vi.fn((operations) => Promise.all(operations)),
  },
  mockIssueBootstrapToken: vi.fn(),
  mockRevalidatePath: vi.fn(),
  mockSyncUserPrincipal: vi.fn(),
}));

vi.mock("@/lib/auth", () => ({ auth: mockAuth }));
vi.mock("@dpf/db", () => ({ prisma: mockPrisma }));
vi.mock("@/lib/edge-node/enrollment", () => ({
  issueBootstrapToken: mockIssueBootstrapToken,
}));
vi.mock("@/lib/identity/principal-linking", () => ({
  syncUserPrincipal: mockSyncUserPrincipal,
}));
vi.mock("next/cache", () => ({ revalidatePath: mockRevalidatePath }));

import {
  approveEdgeNodeAction,
  issueEdgeBootstrapTokenAction,
  quarantineEdgeNodeAction,
  revokeEdgeNodeAction,
} from "./edge-nodes";

const HR000_USER = {
  user: {
    id: "user_admin_1",
    platformRole: "HR-000",
    isSuperuser: false,
  },
};

const NON_ADMIN_USER = {
  user: {
    id: "user_regular_1",
    platformRole: "HR-500",
    isSuperuser: false,
  },
};

const SUPERUSER = {
  user: {
    id: "user_root",
    platformRole: null,
    isSuperuser: true,
  },
};

beforeEach(() => {
  vi.resetAllMocks();
  // Default: principal alias lookup returns a stable principalId so
  // the action records WHO acted (not anonymous).
  mockPrisma.principalAlias.findFirst.mockResolvedValue({
    principalId: "principal_admin_1",
  });
});

afterEach(() => {
  vi.resetAllMocks();
});

describe("assertManagePlatform (via issueEdgeBootstrapTokenAction)", () => {
  it("returns unauthorized when no session", async () => {
    mockAuth.mockResolvedValue(null);
    const result = await issueEdgeBootstrapTokenAction({});
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toBe("unauthorized");
  });

  it("returns forbidden for users without manage_platform", async () => {
    mockAuth.mockResolvedValue(NON_ADMIN_USER);
    const result = await issueEdgeBootstrapTokenAction({});
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toBe("forbidden");
  });

  it("allows HR-000 (platform admin)", async () => {
    mockAuth.mockResolvedValue(HR000_USER);
    mockIssueBootstrapToken.mockResolvedValue({
      tokenId: "boot_1",
      plaintext: "dpfboot_xyz",
      prefix: "dpfboot_xyz",
      expiresAt: new Date(Date.now() + 15 * 60_000),
    });
    const result = await issueEdgeBootstrapTokenAction({});
    expect(result.ok).toBe(true);
  });

  it("allows superuser regardless of platformRole", async () => {
    mockAuth.mockResolvedValue(SUPERUSER);
    mockIssueBootstrapToken.mockResolvedValue({
      tokenId: "boot_2",
      plaintext: "dpfboot_su",
      prefix: "dpfboot_su",
      expiresAt: new Date(Date.now() + 60_000),
    });
    const result = await issueEdgeBootstrapTokenAction({});
    expect(result.ok).toBe(true);
  });
});

describe("issueEdgeBootstrapTokenAction", () => {
  beforeEach(() => mockAuth.mockResolvedValue(HR000_USER));

  it("returns the plaintext / prefix / expiresAt on success", async () => {
    const expires = new Date(Date.now() + 15 * 60_000);
    mockIssueBootstrapToken.mockResolvedValue({
      tokenId: "boot_1",
      plaintext: "dpfboot_SECRET",
      prefix: "dpfboot_SEC",
      expiresAt: expires,
    });
    const result = await issueEdgeBootstrapTokenAction({});
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.plaintext).toBe("dpfboot_SECRET");
      expect(result.prefix).toBe("dpfboot_SEC");
      expect(result.expiresAt).toBe(expires.toISOString());
    }
  });

  it("attributes the issuance to the calling operator's Principal", async () => {
    mockIssueBootstrapToken.mockResolvedValue({
      tokenId: "boot_1",
      plaintext: "dpfboot_x",
      prefix: "dpfboot_x",
      expiresAt: new Date(),
    });
    await issueEdgeBootstrapTokenAction({});
    expect(mockIssueBootstrapToken).toHaveBeenCalledWith(
      expect.objectContaining({ issuedByPrincipalId: "principal_admin_1" }),
    );
  });

  it("rejects negative ttlMs", async () => {
    const result = await issueEdgeBootstrapTokenAction({ ttlMs: -100 });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toBe("invalid_input");
  });

  it("rejects non-finite ttlMs", async () => {
    const result = await issueEdgeBootstrapTokenAction({ ttlMs: Infinity });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toBe("invalid_input");
  });

  it("rejects targetCustomerSiteId without targetCustomerAccountId", async () => {
    const result = await issueEdgeBootstrapTokenAction({
      targetCustomerSiteId: "site_hq",
    });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toBe("invalid_input");
    expect(mockIssueBootstrapToken).not.toHaveBeenCalled();
  });

  it("forwards customer/site targets to the bootstrap issuer", async () => {
    mockPrisma.customerAccount.findUnique.mockResolvedValue({
      id: "cust_acme",
    });
    mockPrisma.customerSite.findFirst.mockResolvedValue({
      id: "site_hq",
    });
    mockIssueBootstrapToken.mockResolvedValue({
      tokenId: "boot_scoped",
      plaintext: "dpfboot_scoped",
      prefix: "dpfboot_sco",
      expiresAt: new Date(),
    });

    await issueEdgeBootstrapTokenAction({
      targetCustomerAccountId: "cust_acme",
      targetCustomerSiteId: "site_hq",
    });

    expect(mockIssueBootstrapToken).toHaveBeenCalledWith(
      expect.objectContaining({
        issuedByPrincipalId: "principal_admin_1",
        targetCustomerAccountId: "cust_acme",
        targetCustomerSiteId: "site_hq",
      }),
    );
  });

  it("rejects an unknown customer account target before issuing a token", async () => {
    mockPrisma.customerAccount.findUnique.mockResolvedValue(null);

    const result = await issueEdgeBootstrapTokenAction({
      targetCustomerAccountId: "cust_missing",
    });

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toBe("invalid_input");
      expect(result.message).toContain("Customer account");
    }
    expect(mockIssueBootstrapToken).not.toHaveBeenCalled();
  });

  it("rejects a customer site target that does not belong to the selected account", async () => {
    mockPrisma.customerAccount.findUnique.mockResolvedValue({
      id: "cust_acme",
    });
    mockPrisma.customerSite.findFirst.mockResolvedValue(null);

    const result = await issueEdgeBootstrapTokenAction({
      targetCustomerAccountId: "cust_acme",
      targetCustomerSiteId: "site_other",
    });

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toBe("invalid_input");
      expect(result.message).toContain("Customer site");
    }
    expect(mockIssueBootstrapToken).not.toHaveBeenCalled();
  });

  it("revalidates the admin path on success so the table re-renders", async () => {
    mockIssueBootstrapToken.mockResolvedValue({
      tokenId: "boot_1",
      plaintext: "dpfboot_x",
      prefix: "dpfboot_x",
      expiresAt: new Date(),
    });
    await issueEdgeBootstrapTokenAction({});
    expect(mockRevalidatePath).toHaveBeenCalledWith("/platform/edge-nodes");
  });

  it("returns internal_error when the underlying issuer throws", async () => {
    mockIssueBootstrapToken.mockRejectedValue(new Error("DB went away"));
    const result = await issueEdgeBootstrapTokenAction({});
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toBe("internal_error");
      expect(result.message).toContain("DB went away");
    }
  });
});

describe("approveEdgeNodeAction", () => {
  beforeEach(() => mockAuth.mockResolvedValue(HR000_USER));

  it("returns not_found for unknown edgeNodeId", async () => {
    mockPrisma.edgeNode.findUnique.mockResolvedValue(null);
    const result = await approveEdgeNodeAction("edge_x");
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toBe("not_found");
  });

  it("rejects approval of a revoked node", async () => {
    mockPrisma.edgeNode.findUnique.mockResolvedValue({
      id: "edge_1",
      trustState: "revoked",
    });
    const result = await approveEdgeNodeAction("edge_1");
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toBe("invalid_transition");
      expect(result.message).toContain("re-enrollment");
    }
  });

  it("flips pending → trusted + sets approvedAt + approvedByPrincipalId", async () => {
    mockPrisma.edgeNode.findUnique.mockResolvedValue({
      id: "edge_1",
      trustState: "pending",
    });
    mockPrisma.edgeNode.update.mockResolvedValue({});
    const result = await approveEdgeNodeAction("edge_1");
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.trustState).toBe("trusted");
    const updateCall = mockPrisma.edgeNode.update.mock.calls[0]![0];
    expect(updateCall.data.trustState).toBe("trusted");
    expect(updateCall.data.status).toBe("active");
    expect(updateCall.data.approvedByPrincipalId).toBe("principal_admin_1");
    expect(updateCall.data.approvedAt).toBeInstanceOf(Date);
  });

  it("clears quarantine fields when restoring a quarantined node", async () => {
    mockPrisma.edgeNode.findUnique.mockResolvedValue({
      id: "edge_1",
      trustState: "quarantined",
    });
    mockPrisma.edgeNode.update.mockResolvedValue({});
    await approveEdgeNodeAction("edge_1");
    const updateCall = mockPrisma.edgeNode.update.mock.calls[0]![0];
    expect(updateCall.data.quarantinedAt).toBeNull();
    expect(updateCall.data.quarantineReason).toBeNull();
    expect(mockPrisma.edgeNodeCertificate.updateMany).toHaveBeenCalledWith({
      where: { edgeNodeId: "edge_1", status: "quarantined", validUntil: { gt: expect.any(Date) } },
      data: { status: "active", revokedAt: null, revocationReason: null },
    });
  });
});

describe("quarantineEdgeNodeAction", () => {
  beforeEach(() => mockAuth.mockResolvedValue(HR000_USER));

  it("requires a non-empty reason", async () => {
    const r1 = await quarantineEdgeNodeAction("edge_1", "");
    expect(r1.ok).toBe(false);
    if (!r1.ok) expect(r1.error).toBe("invalid_input");
    const r2 = await quarantineEdgeNodeAction("edge_1", "   ");
    expect(r2.ok).toBe(false);
  });

  it("returns not_found for unknown node", async () => {
    mockPrisma.edgeNode.findUnique.mockResolvedValue(null);
    const result = await quarantineEdgeNodeAction("edge_x", "anomaly");
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toBe("not_found");
  });

  it("rejects quarantine of a revoked node", async () => {
    mockPrisma.edgeNode.findUnique.mockResolvedValue({
      id: "edge_1",
      trustState: "revoked",
    });
    const result = await quarantineEdgeNodeAction("edge_1", "anomaly");
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toBe("invalid_transition");
  });

  it("stamps trustState=quarantined + reason + timestamp", async () => {
    mockPrisma.edgeNode.findUnique.mockResolvedValue({
      id: "edge_1",
      trustState: "trusted",
    });
    mockPrisma.edgeNode.update.mockResolvedValue({});
    await quarantineEdgeNodeAction("edge_1", "deviance threshold exceeded");
    const updateCall = mockPrisma.edgeNode.update.mock.calls[0]![0];
    expect(updateCall.data.trustState).toBe("quarantined");
    expect(updateCall.data.status).toBe("quarantined");
    expect(updateCall.data.quarantineReason).toBe("deviance threshold exceeded");
    expect(updateCall.data.quarantinedAt).toBeInstanceOf(Date);
    expect(mockPrisma.edgeNodeCertificate.updateMany).toHaveBeenCalledWith({
      where: { edgeNodeId: "edge_1", status: "active" },
      data: {
        status: "quarantined",
        revokedAt: expect.any(Date),
        revocationReason: "node_quarantined:deviance threshold exceeded",
      },
    });
  });
});

describe("revokeEdgeNodeAction", () => {
  beforeEach(() => mockAuth.mockResolvedValue(HR000_USER));

  it("requires a non-empty reason", async () => {
    const result = await revokeEdgeNodeAction("edge_1", "");
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toBe("invalid_input");
  });

  it("returns not_found for unknown node", async () => {
    mockPrisma.edgeNode.findUnique.mockResolvedValue(null);
    const result = await revokeEdgeNodeAction("edge_x", "compromised");
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toBe("not_found");
  });

  it("is idempotent for an already-revoked node", async () => {
    mockPrisma.edgeNode.findUnique.mockResolvedValue({
      id: "edge_1",
      trustState: "revoked",
    });
    const result = await revokeEdgeNodeAction("edge_1", "double-revoke");
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.trustState).toBe("revoked");
    expect(mockPrisma.edgeNode.update).not.toHaveBeenCalled();
  });

  it("nulls the tokenHash + tokenPrefix + tokenRotatedAt so the bearer is invalidated", async () => {
    mockPrisma.edgeNode.findUnique.mockResolvedValue({
      id: "edge_1",
      trustState: "trusted",
    });
    mockPrisma.edgeNode.update.mockResolvedValue({});
    await revokeEdgeNodeAction("edge_1", "compromised");
    const updateCall = mockPrisma.edgeNode.update.mock.calls[0]![0];
    expect(updateCall.data.trustState).toBe("revoked");
    expect(updateCall.data.tokenHash).toBeNull();
    expect(updateCall.data.tokenPrefix).toBeNull();
    expect(updateCall.data.tokenRotatedAt).toBeNull();
    expect(updateCall.data.revocationReason).toBe("compromised");
    expect(updateCall.data.revokedAt).toBeInstanceOf(Date);
    expect(mockPrisma.edgeNodeCertificate.updateMany).toHaveBeenCalledWith({
      where: { edgeNodeId: "edge_1", status: { not: "revoked" } },
      data: {
        status: "revoked",
        revokedAt: expect.any(Date),
        revocationReason: "node_revoked:compromised",
      },
    });
  });
});

describe("Principal-attribution self-heal", () => {
  beforeEach(() => mockAuth.mockResolvedValue(HR000_USER));

  // Pre-§11 installs / installs that pre-date the seed fix may have a
  // User row without a matching PrincipalAlias. The action used to fall
  // back to a synthetic "user:<id>" string that violated the hard FK
  // (BootstrapToken_issuedByPrincipalId_fkey) and crashed with a Prisma
  // error leaking to the UI. The self-heal calls syncUserPrincipal to
  // create the Principal + alias on the fly, and uses the resulting real
  // principalId.
  it("lazy-creates the Principal+alias via syncUserPrincipal when none exists", async () => {
    mockPrisma.principalAlias.findFirst.mockResolvedValue(null);
    mockSyncUserPrincipal.mockResolvedValue({
      id: "principal_lazy_created_1",
      principalId: "PRN-lazy-1",
      kind: "human",
      status: "active",
      displayName: "admin@dpf.local",
      aliases: [{ aliasType: "user", aliasValue: "user_admin_1", issuer: "" }],
    });
    mockIssueBootstrapToken.mockResolvedValue({
      tokenId: "boot_1",
      plaintext: "dpfboot_x",
      prefix: "dpfboot_x",
      expiresAt: new Date(),
    });

    await issueEdgeBootstrapTokenAction({});

    expect(mockSyncUserPrincipal).toHaveBeenCalledWith("user_admin_1");
    expect(mockIssueBootstrapToken).toHaveBeenCalledWith(
      expect.objectContaining({ issuedByPrincipalId: "principal_lazy_created_1" }),
    );
  });

  it("skips the self-heal when an alias already exists (happy path)", async () => {
    mockPrisma.principalAlias.findFirst.mockResolvedValue({
      principalId: "principal_admin_1",
    });
    mockIssueBootstrapToken.mockResolvedValue({
      tokenId: "boot_1",
      plaintext: "dpfboot_x",
      prefix: "dpfboot_x",
      expiresAt: new Date(),
    });

    await issueEdgeBootstrapTokenAction({});

    expect(mockSyncUserPrincipal).not.toHaveBeenCalled();
    expect(mockIssueBootstrapToken).toHaveBeenCalledWith(
      expect.objectContaining({ issuedByPrincipalId: "principal_admin_1" }),
    );
  });
});
