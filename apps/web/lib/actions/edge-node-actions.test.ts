import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@dpf/db", () => ({
  prisma: {
    edgeNode: {
      findMany: vi.fn(),
      findUnique: vi.fn(),
      update: vi.fn(),
    },
    edgeNodeCapability: {
      updateMany: vi.fn(),
    },
    bootstrapToken: {
      create: vi.fn(),
    },
    principalAlias: {
      findUnique: vi.fn(),
      create: vi.fn(),
    },
    principal: {
      create: vi.fn(),
    },
    $transaction: vi.fn(),
  },
}));

vi.mock("@/lib/auth", () => ({
  auth: vi.fn(),
}));

vi.mock("next/cache", () => ({
  revalidatePath: vi.fn(),
}));

import { prisma } from "@dpf/db";

import { auth } from "@/lib/auth";

import {
  approveEdgeNode,
  issueEdgeNodeBootstrapToken,
  listEdgeNodes,
  quarantineEdgeNode,
  revokeEdgeNode,
  unquarantineEdgeNode,
} from "./edge-node-actions";

const authMock = auth as unknown as ReturnType<typeof vi.fn>;
const findManyMock = prisma.edgeNode.findMany as unknown as ReturnType<typeof vi.fn>;
const findUniqueMock = prisma.edgeNode.findUnique as unknown as ReturnType<typeof vi.fn>;
const updateMock = prisma.edgeNode.update as unknown as ReturnType<typeof vi.fn>;
const capUpdateManyMock = prisma.edgeNodeCapability.updateMany as unknown as ReturnType<typeof vi.fn>;
const tokenCreateMock = prisma.bootstrapToken.create as unknown as ReturnType<typeof vi.fn>;
const aliasFindUniqueMock = prisma.principalAlias.findUnique as unknown as ReturnType<typeof vi.fn>;
const transactionMock = prisma.$transaction as unknown as ReturnType<typeof vi.fn>;

const ADMIN_USER = {
  id: "user_admin",
  email: "admin@dpf.local",
  platformRole: "HR-000",
  isSuperuser: false,
};

const NON_ADMIN_USER = {
  id: "user_visitor",
  email: "visitor@dpf.local",
  platformRole: "HR-300",
  isSuperuser: false,
};

beforeEach(() => {
  vi.resetAllMocks();
  aliasFindUniqueMock.mockResolvedValue({
    principalId: "principal_user_admin",
    principal: { id: "principal_user_admin" },
  });
});

// ── Auth gate ────────────────────────────────────────────────────────────────

describe("auth gate (every action)", () => {
  it("listEdgeNodes throws Unauthorized when not signed in", async () => {
    authMock.mockResolvedValueOnce({ user: null } as never);
    await expect(listEdgeNodes()).rejects.toThrow(/Unauthorized/);
  });

  it("listEdgeNodes throws Unauthorized for non-platform-managers", async () => {
    authMock.mockResolvedValueOnce({ user: NON_ADMIN_USER } as never);
    await expect(listEdgeNodes()).rejects.toThrow(/Unauthorized/);
  });

  it("issueEdgeNodeBootstrapToken throws Unauthorized for non-managers", async () => {
    authMock.mockResolvedValueOnce({ user: NON_ADMIN_USER } as never);
    await expect(issueEdgeNodeBootstrapToken()).rejects.toThrow(
      /Unauthorized/,
    );
  });

  it("revokeEdgeNode throws Unauthorized for non-managers", async () => {
    authMock.mockResolvedValueOnce({ user: null } as never);
    await expect(
      revokeEdgeNode({ edgeNodeId: "x", reason: "test" }),
    ).rejects.toThrow(/Unauthorized/);
  });
});

// ── listEdgeNodes ───────────────────────────────────────────────────────────

describe("listEdgeNodes", () => {
  it("returns rows ordered by lastSeenAt desc + serialized timestamps", async () => {
    authMock.mockResolvedValueOnce({ user: ADMIN_USER } as never);
    const now = new Date("2026-05-12T12:00:00Z");
    findManyMock.mockResolvedValueOnce([
      {
        id: "edge_1",
        nodeId: "edge_aaa",
        displayName: "Node A",
        platform: "linux",
        installMode: "container-host",
        version: "0.1.0",
        status: "active",
        trustState: "trusted",
        lastSeenAt: now,
        capabilities: ["discovery.network"],
        metadata: null,
        tokenHash: "h",
        tokenPrefix: "dpfedge_xyz",
        tokenRotatedAt: now,
        enrolledAt: now,
        approvedAt: now,
        approvedByPrincipalId: "principal_user_admin",
        quarantinedAt: null,
        quarantineReason: null,
        revokedAt: null,
        revocationReason: null,
        createdAt: now,
        updatedAt: now,
      },
    ]);

    const result = await listEdgeNodes();
    expect(result).toHaveLength(1);
    expect(result[0]!.lastSeenAt).toBe("2026-05-12T12:00:00.000Z");
    expect(result[0]!.capabilities).toEqual(["discovery.network"]);
    expect(findManyMock).toHaveBeenCalledOnce();
    const orderBy = findManyMock.mock.calls[0]?.[0]?.orderBy;
    expect(orderBy?.[0]?.lastSeenAt?.sort).toBe("desc");
  });
});

// ── issueEdgeNodeBootstrapToken ──────────────────────────────────────────────

describe("issueEdgeNodeBootstrapToken", () => {
  it("clamps requested TTL to the spec's 24h max", async () => {
    authMock.mockResolvedValueOnce({ user: ADMIN_USER } as never);
    tokenCreateMock.mockImplementation(
      async ({ data }: { data: { tokenHash: string; expiresAt: Date } }) => ({
        id: "btok_1",
        ...data,
        consumedAt: null,
        consumedByEdgeNodeId: null,
        revokedAt: null,
      }),
    );

    const huge = 7 * 24 * 60; // one week, must clamp to 24h
    const result = await issueEdgeNodeBootstrapToken({ ttlMinutes: huge });

    const passedData = tokenCreateMock.mock.calls[0]?.[0]?.data;
    expect(passedData).toBeDefined();
    const ttlMs = passedData.expiresAt.getTime() - Date.now();
    // Tolerance for the now-vs-mock-time gap
    expect(ttlMs).toBeLessThanOrEqual(24 * 60 * 60 * 1000 + 5000);
    expect(ttlMs).toBeGreaterThan(23.9 * 60 * 60 * 1000);

    expect(result.plaintext.startsWith("dpfboot_")).toBe(true);
    expect(result.prefix.startsWith("dpfboot_")).toBe(true);
  });

  it("clamps requested TTL to the 1-minute floor", async () => {
    authMock.mockResolvedValueOnce({ user: ADMIN_USER } as never);
    tokenCreateMock.mockImplementation(
      async ({ data }: { data: { expiresAt: Date } }) => ({
        id: "btok_2",
        ...data,
      }),
    );
    await issueEdgeNodeBootstrapToken({ ttlMinutes: 0 });
    const passedData = tokenCreateMock.mock.calls[0]?.[0]?.data;
    const ttlMs = passedData.expiresAt.getTime() - Date.now();
    expect(ttlMs).toBeGreaterThanOrEqual(60_000 - 100);
    expect(ttlMs).toBeLessThan(120_000);
  });

  it("attributes issuance to the operator's Principal id", async () => {
    authMock.mockResolvedValueOnce({ user: ADMIN_USER } as never);
    tokenCreateMock.mockImplementation(
      async ({ data }: { data: unknown }) => ({
        id: "btok_3",
        ...(data as Record<string, unknown>),
      }),
    );
    await issueEdgeNodeBootstrapToken();
    const passedData = tokenCreateMock.mock.calls[0]?.[0]?.data;
    expect(passedData.issuedByPrincipalId).toBe("principal_user_admin");
  });
});

// ── quarantineEdgeNode ─────────────────────────────────────────────────────

describe("quarantineEdgeNode", () => {
  it("requires a non-empty reason", async () => {
    authMock.mockResolvedValueOnce({ user: ADMIN_USER } as never);
    await expect(
      quarantineEdgeNode({ edgeNodeId: "edge_1", reason: "   " }),
    ).rejects.toThrow(/reason is required/);
  });

  it("sets trustState=quarantined + records reason + timestamp", async () => {
    authMock.mockResolvedValueOnce({ user: ADMIN_USER } as never);
    updateMock.mockResolvedValueOnce({} as never);

    await quarantineEdgeNode({
      edgeNodeId: "edge_cuid_1",
      reason: "anomaly-detected",
    });

    expect(updateMock).toHaveBeenCalledOnce();
    const call = updateMock.mock.calls[0]?.[0];
    expect(call.where).toEqual({ id: "edge_cuid_1" });
    expect(call.data.trustState).toBe("quarantined");
    expect(call.data.status).toBe("quarantined");
    expect(call.data.quarantineReason).toBe("anomaly-detected");
    expect(call.data.quarantinedAt).toBeInstanceOf(Date);
  });
});

// ── unquarantineEdgeNode ──────────────────────────────────────────────────

describe("unquarantineEdgeNode", () => {
  it("refuses if the node isn't currently quarantined", async () => {
    authMock.mockResolvedValueOnce({ user: ADMIN_USER } as never);
    findUniqueMock.mockResolvedValueOnce({
      trustState: "trusted",
      approvedAt: new Date(),
    });
    await expect(
      unquarantineEdgeNode({ edgeNodeId: "edge_1" }),
    ).rejects.toThrow(/trustState=trusted/);
  });

  it("returns to trusted when previously approved", async () => {
    authMock.mockResolvedValueOnce({ user: ADMIN_USER } as never);
    findUniqueMock.mockResolvedValueOnce({
      trustState: "quarantined",
      approvedAt: new Date(),
    });
    updateMock.mockResolvedValueOnce({} as never);

    await unquarantineEdgeNode({ edgeNodeId: "edge_1" });

    const call = updateMock.mock.calls[0]?.[0];
    expect(call.data.trustState).toBe("trusted");
    expect(call.data.quarantinedAt).toBe(null);
    expect(call.data.quarantineReason).toBe(null);
  });

  it("returns to pending when never approved (defensive path)", async () => {
    authMock.mockResolvedValueOnce({ user: ADMIN_USER } as never);
    findUniqueMock.mockResolvedValueOnce({
      trustState: "quarantined",
      approvedAt: null,
    });
    updateMock.mockResolvedValueOnce({} as never);

    await unquarantineEdgeNode({ edgeNodeId: "edge_1" });
    const call = updateMock.mock.calls[0]?.[0];
    expect(call.data.trustState).toBe("pending");
  });
});

// ── revokeEdgeNode ─────────────────────────────────────────────────────────

describe("revokeEdgeNode", () => {
  it("requires a non-empty reason", async () => {
    authMock.mockResolvedValueOnce({ user: ADMIN_USER } as never);
    await expect(
      revokeEdgeNode({ edgeNodeId: "edge_1", reason: "" }),
    ).rejects.toThrow(/reason is required/);
  });

  it("invalidates the token hash so the agent can no longer auth", async () => {
    authMock.mockResolvedValueOnce({ user: ADMIN_USER } as never);
    updateMock.mockResolvedValueOnce({} as never);

    await revokeEdgeNode({
      edgeNodeId: "edge_cuid_1",
      reason: "operator-revoked",
    });

    const call = updateMock.mock.calls[0]?.[0];
    expect(call.data.trustState).toBe("revoked");
    expect(call.data.tokenHash).toBe(null);
    expect(call.data.tokenPrefix).toBe(null);
    expect(call.data.revocationReason).toBe("operator-revoked");
    expect(call.data.revokedAt).toBeInstanceOf(Date);
  });
});

// ── approveEdgeNode ───────────────────────────────────────────────────────

describe("approveEdgeNode", () => {
  it("refuses if the node isn't pending", async () => {
    authMock.mockResolvedValueOnce({ user: ADMIN_USER } as never);
    findUniqueMock.mockResolvedValueOnce({ trustState: "trusted" });
    await expect(
      approveEdgeNode({ edgeNodeId: "edge_1" }),
    ).rejects.toThrow(/trustState=trusted/);
  });

  it("flips trustState=trusted + capability mode=enabled atomically", async () => {
    authMock.mockResolvedValueOnce({ user: ADMIN_USER } as never);
    findUniqueMock.mockResolvedValueOnce({ trustState: "pending" });

    const txCalls: Array<{ table: string; data: Record<string, unknown> }> = [];
    transactionMock.mockImplementation(async (fn: (tx: unknown) => Promise<unknown>) => {
      const tx = {
        edgeNode: {
          update: vi.fn(async (args: { data: Record<string, unknown> }) => {
            txCalls.push({ table: "edgeNode", data: args.data });
            return {};
          }),
        },
        edgeNodeCapability: {
          updateMany: vi.fn(async (args: { where: Record<string, unknown>; data: Record<string, unknown> }) => {
            txCalls.push({
              table: "edgeNodeCapability",
              data: { ...args.where, ...args.data },
            });
            return { count: 1 };
          }),
        },
      };
      return fn(tx);
    });

    await approveEdgeNode({ edgeNodeId: "edge_1" });

    expect(txCalls).toHaveLength(2);
    expect(txCalls[0]?.table).toBe("edgeNode");
    expect(txCalls[0]?.data.trustState).toBe("trusted");
    expect(txCalls[0]?.data.approvedByPrincipalId).toBe("principal_user_admin");
    expect(txCalls[1]?.table).toBe("edgeNodeCapability");
    expect(txCalls[1]?.data.mode).toBe("enabled");
  });
});
