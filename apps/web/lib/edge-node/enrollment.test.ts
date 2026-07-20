import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@dpf/db", () => ({
  prisma: {
    bootstrapToken: {
      create: vi.fn(),
      findUnique: vi.fn(),
      update: vi.fn(),
    },
    edgeNode: {
      update: vi.fn(),
    },
    edgeNodeCapability: {
      findMany: vi.fn(),
      upsert: vi.fn(),
    },
    $transaction: vi.fn(),
  },
}));

import { prisma } from "@dpf/db";

import {
  enrollEdgeNode,
  issueBootstrapToken,
  recordHeartbeat,
} from "./enrollment";
import { hashToken } from "./tokens";

const tokFindUnique = prisma.bootstrapToken.findUnique as unknown as ReturnType<
  typeof vi.fn
>;
const tokCreate = prisma.bootstrapToken.create as unknown as ReturnType<
  typeof vi.fn
>;
const $transaction = prisma.$transaction as unknown as ReturnType<typeof vi.fn>;
const capFindMany = prisma.edgeNodeCapability.findMany as unknown as ReturnType<
  typeof vi.fn
>;

beforeEach(() => {
  vi.resetAllMocks();
});

// ── issueBootstrapToken ──────────────────────────────────────────────────────

describe("issueBootstrapToken", () => {
  it("creates a row + returns the plaintext exactly once", async () => {
    tokCreate.mockImplementation(async ({ data }: { data: { tokenHash: string; expiresAt: Date } }) => ({
      id: "btok_cuid_1",
      ...data,
      consumedAt: null,
      consumedByEdgeNodeId: null,
      revokedAt: null,
    }));

    const result = await issueBootstrapToken({
      issuedByPrincipalId: "principal_user_admin",
    });

    expect(result.tokenId).toBe("btok_cuid_1");
    expect(result.plaintext.startsWith("dpfboot_")).toBe(true);
    expect(result.prefix.startsWith("dpfboot_")).toBe(true);
    expect(result.expiresAt.getTime()).toBeGreaterThan(Date.now());

    // Persisted row sees the hash, NEVER the plaintext.
    expect(tokCreate).toHaveBeenCalledOnce();
    const persistedData = tokCreate.mock.calls[0]?.[0]?.data;
    expect(persistedData).toBeDefined();
    expect(persistedData.tokenHash).toBe(hashToken(result.plaintext));
    expect(persistedData.tokenHash).not.toBe(result.plaintext);
  });

  it("defaults autoApprove=false when not specified", async () => {
    tokCreate.mockImplementation(async ({ data }: { data: { tokenHash: string; expiresAt: Date } }) => ({
      id: "btok_cuid_default",
      ...data,
      consumedAt: null,
      consumedByEdgeNodeId: null,
      revokedAt: null,
    }));

    await issueBootstrapToken({ issuedByPrincipalId: "principal_user_admin" });

    const persistedData = tokCreate.mock.calls[0]?.[0]?.data;
    // Paste-provisioned tokens (the common case) MUST NOT auto-approve
    // — otherwise an operator sharing a token with a remote host
    // skips the Approve click intended as the trust boundary.
    expect(persistedData?.autoApprove).toBe(false);
  });

  it("persists autoApprove=true when the caller flags it", async () => {
    tokCreate.mockImplementation(async ({ data }: { data: { tokenHash: string; expiresAt: Date } }) => ({
      id: "btok_cuid_installer",
      ...data,
      consumedAt: null,
      consumedByEdgeNodeId: null,
      revokedAt: null,
    }));

    await issueBootstrapToken({
      issuedByPrincipalId: "principal_installer",
      autoApprove: true,
    });

    const persistedData = tokCreate.mock.calls[0]?.[0]?.data;
    expect(persistedData?.autoApprove).toBe(true);
  });

  it("persists customer/site scope onto the bootstrap token", async () => {
    tokCreate.mockImplementation(async ({ data }: { data: { tokenHash: string; expiresAt: Date } }) => ({
      id: "btok_cuid_scoped",
      ...data,
      consumedAt: null,
      consumedByEdgeNodeId: null,
      revokedAt: null,
    }));

    await issueBootstrapToken({
      issuedByPrincipalId: "principal_user_admin",
      targetCustomerAccountId: "cust_acme",
      targetCustomerSiteId: "site_hq",
    });

    const persistedData = tokCreate.mock.calls[0]?.[0]?.data;
    expect(persistedData).toMatchObject({
      targetCustomerAccountId: "cust_acme",
      targetCustomerSiteId: "site_hq",
      scopePolicy: {
        ownershipScope: "customer-site",
        enforcement: "strict-customer-scope",
        source: "bootstrap-token",
        customerAccountId: "cust_acme",
        customerSiteId: "site_hq",
      },
    });
  });
});

// ── enrollEdgeNode — validation paths (no transaction needed) ────────────────

describe("enrollEdgeNode — validation", () => {
  it("rejects wrong token prefix without hitting the DB", async () => {
    const result = await enrollEdgeNode({
      bootstrapToken: "dpfedge_WRONGNAMESPACE",
      displayName: "x",
      platform: "linux",
      installMode: "container-host",
      version: "0.1.0",
      advertisedCapabilities: ["discovery.network"],
    });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toBe("invalid_token_format");
    expect(tokFindUnique).not.toHaveBeenCalled();
  });

  it("rejects unknown platform", async () => {
    const result = await enrollEdgeNode({
      bootstrapToken: "dpfboot_VALID",
      displayName: "x",
      // @ts-expect-error intentionally wrong literal
      platform: "freebsd",
      installMode: "container-host",
      version: "0.1.0",
      advertisedCapabilities: ["discovery.network"],
    });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toBe("invalid_platform");
  });

  it("rejects unknown installMode", async () => {
    const result = await enrollEdgeNode({
      bootstrapToken: "dpfboot_VALID",
      displayName: "x",
      platform: "linux",
      // @ts-expect-error intentionally wrong literal
      installMode: "wasm",
      version: "0.1.0",
      advertisedCapabilities: ["discovery.network"],
    });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toBe("invalid_install_mode");
  });

  it("rejects when no capabilities intersect the Phase 0 set", async () => {
    const result = await enrollEdgeNode({
      bootstrapToken: "dpfboot_VALID",
      displayName: "x",
      platform: "linux",
      installMode: "container-host",
      version: "0.1.0",
      // mcp.gateway is reserved but not Phase 0 acceptable
      advertisedCapabilities: ["mcp.gateway"],
    });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toBe("no_acceptable_capabilities");
  });

  it("accepts native federation discovery without opening other reserved capabilities", async () => {
    tokFindUnique.mockResolvedValueOnce(null);
    const result = await enrollEdgeNode({
      bootstrapToken: "dpfboot_GHOST",
      displayName: "native-edge",
      platform: "darwin",
      installMode: "native",
      version: "0.2.0",
      advertisedCapabilities: ["federation.discovery"],
    });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toBe("token_not_found");
    expect(tokFindUnique).toHaveBeenCalledOnce();
  });

  it("rejects token not found", async () => {
    tokFindUnique.mockResolvedValueOnce(null);
    const result = await enrollEdgeNode({
      bootstrapToken: "dpfboot_GHOST",
      displayName: "x",
      platform: "linux",
      installMode: "container-host",
      version: "0.1.0",
      advertisedCapabilities: ["discovery.network"],
    });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toBe("token_not_found");
  });

  it("rejects already-consumed token (single-use)", async () => {
    tokFindUnique.mockResolvedValueOnce({
      id: "btok",
      tokenHash: "hash",
      prefix: "dpfboot_xyz",
      scope: "edge:enroll",
      issuedAt: new Date(),
      issuedByPrincipalId: "principal_admin",
      expiresAt: new Date(Date.now() + 60_000),
      consumedAt: new Date(Date.now() - 1000),
      consumedByEdgeNodeId: "edgenode_existing",
      revokedAt: null,
    });
    const result = await enrollEdgeNode({
      bootstrapToken: "dpfboot_USED",
      displayName: "x",
      platform: "linux",
      installMode: "container-host",
      version: "0.1.0",
      advertisedCapabilities: ["discovery.network"],
    });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toBe("token_already_consumed");
  });

  it("rejects revoked token", async () => {
    tokFindUnique.mockResolvedValueOnce({
      id: "btok",
      tokenHash: "hash",
      prefix: "dpfboot_xyz",
      scope: "edge:enroll",
      issuedAt: new Date(),
      issuedByPrincipalId: "principal_admin",
      expiresAt: new Date(Date.now() + 60_000),
      consumedAt: null,
      consumedByEdgeNodeId: null,
      revokedAt: new Date(Date.now() - 1000),
    });
    const result = await enrollEdgeNode({
      bootstrapToken: "dpfboot_REVOKED",
      displayName: "x",
      platform: "linux",
      installMode: "container-host",
      version: "0.1.0",
      advertisedCapabilities: ["discovery.network"],
    });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toBe("token_revoked");
  });

  it("rejects expired token", async () => {
    tokFindUnique.mockResolvedValueOnce({
      id: "btok",
      tokenHash: "hash",
      prefix: "dpfboot_xyz",
      scope: "edge:enroll",
      issuedAt: new Date(),
      issuedByPrincipalId: "principal_admin",
      expiresAt: new Date(Date.now() - 1000),
      consumedAt: null,
      consumedByEdgeNodeId: null,
      revokedAt: null,
    });
    const result = await enrollEdgeNode({
      bootstrapToken: "dpfboot_EXPIRED",
      displayName: "x",
      platform: "linux",
      installMode: "container-host",
      version: "0.1.0",
      advertisedCapabilities: ["discovery.network"],
    });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toBe("token_expired");
  });
});

// ── enrollEdgeNode — happy path ──────────────────────────────────────────────

describe("enrollEdgeNode — happy path", () => {
  it("creates Principal + Alias + EdgeNode + capability rows atomically", async () => {
    tokFindUnique.mockResolvedValueOnce({
      id: "btok_1",
      tokenHash: "hash",
      prefix: "dpfboot_xyz",
      scope: "edge:enroll",
      issuedAt: new Date(),
      issuedByPrincipalId: "principal_admin",
      expiresAt: new Date(Date.now() + 60_000),
      consumedAt: null,
      consumedByEdgeNodeId: null,
      revokedAt: null,
    });

    let txCalls: Array<{ table: string; op: string; data?: unknown }> = [];
    $transaction.mockImplementation(async (fn: (tx: unknown) => Promise<unknown>) => {
      const tx = {
        bootstrapToken: {
          update: vi.fn(async (args: { data: unknown }) => {
            txCalls.push({ table: "bootstrapToken", op: "update", data: args.data });
            return {};
          }),
        },
        principal: {
          create: vi.fn(async (args: { data: unknown }) => {
            txCalls.push({ table: "principal", op: "create", data: args.data });
            return { id: "principal_edge_1" };
          }),
        },
        principalAlias: {
          create: vi.fn(async (args: { data: unknown }) => {
            txCalls.push({ table: "principalAlias", op: "create", data: args.data });
            return {};
          }),
        },
        edgeNode: {
          create: vi.fn(async (args: { data: unknown }) => {
            txCalls.push({ table: "edgeNode", op: "create", data: args.data });
            return { id: "edgenode_1" };
          }),
        },
        edgeNodeCapability: {
          create: vi.fn(async (args: { data: unknown }) => {
            txCalls.push({ table: "edgeNodeCapability", op: "create", data: args.data });
            return {};
          }),
        },
      };
      return fn(tx);
    });

    const result = await enrollEdgeNode({
      bootstrapToken: "dpfboot_VALIDTOKEN",
      displayName: "Edge Node 1",
      platform: "linux",
      installMode: "container-host",
      version: "0.1.0",
      advertisedCapabilities: ["discovery.network"],
      autoApprove: true,
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;

    expect(result.nodeId.startsWith("edge_")).toBe(true);
    expect(result.nodeToken.startsWith("dpfedge_")).toBe(true);
    expect(result.acceptedCapabilities).toEqual(["discovery.network"]);
    expect(result.trustState).toBe("trusted");
    expect(result.heartbeatIntervalSec).toBeGreaterThan(0);
    expect(result.sweepIntervalSec).toBeGreaterThan(0);

    // Verify the transactional write order: token consumed → principal →
    // alias → edgeNode → token-back-link → capability.
    const tables = txCalls.map((c) => `${c.table}.${c.op}`);
    expect(tables).toEqual([
      "bootstrapToken.update",
      "principal.create",
      "principalAlias.create",
      "edgeNode.create",
      "bootstrapToken.update",
      "edgeNodeCapability.create",
    ]);

    // The PrincipalAlias is created with aliasType=edge_node per
    // the principal-convergence rule.
    const aliasCall = txCalls.find((c) => c.table === "principalAlias");
    expect(aliasCall?.data).toMatchObject({
      principalId: "principal_edge_1",
      aliasType: "edge_node",
      aliasValue: result.nodeId,
    });

    // The capability mode is `enabled` because autoApprove=true.
    const capCall = txCalls.find((c) => c.table === "edgeNodeCapability");
    expect(capCall?.data).toMatchObject({
      capability: "discovery.network",
      mode: "enabled",
    });
  });

  it("non-autoApprove enrollment yields trustState=pending and capability mode=disabled", async () => {
    tokFindUnique.mockResolvedValueOnce({
      id: "btok_1",
      tokenHash: "hash",
      prefix: "dpfboot_xyz",
      scope: "edge:enroll",
      issuedAt: new Date(),
      issuedByPrincipalId: "principal_admin",
      expiresAt: new Date(Date.now() + 60_000),
      consumedAt: null,
      consumedByEdgeNodeId: null,
      revokedAt: null,
    });

    let capRowMode: string | undefined;
    $transaction.mockImplementation(async (fn: (tx: unknown) => Promise<unknown>) => {
      const tx = {
        bootstrapToken: { update: vi.fn(async () => ({})) },
        principal: { create: vi.fn(async () => ({ id: "principal_edge_2" })) },
        principalAlias: { create: vi.fn(async () => ({})) },
        edgeNode: { create: vi.fn(async () => ({ id: "edgenode_2" })) },
        edgeNodeCapability: {
          create: vi.fn(async (args: { data: { mode: string } }) => {
            capRowMode = args.data.mode;
            return {};
          }),
        },
      };
      return fn(tx);
    });

    const result = await enrollEdgeNode({
      bootstrapToken: "dpfboot_VALID2",
      displayName: "Edge Node 2",
      platform: "linux",
      installMode: "container-host",
      version: "0.1.0",
      advertisedCapabilities: ["discovery.network"],
      autoApprove: false,
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.trustState).toBe("pending");
    expect(capRowMode).toBe("disabled");
  });

  it("ignores capabilities outside the Phase 0 accepted set", async () => {
    tokFindUnique.mockResolvedValueOnce({
      id: "btok_1",
      tokenHash: "hash",
      prefix: "dpfboot_xyz",
      scope: "edge:enroll",
      issuedAt: new Date(),
      issuedByPrincipalId: "principal_admin",
      expiresAt: new Date(Date.now() + 60_000),
      consumedAt: null,
      consumedByEdgeNodeId: null,
      revokedAt: null,
    });

    let capabilityRowsCreated = 0;
    $transaction.mockImplementation(async (fn: (tx: unknown) => Promise<unknown>) => {
      const tx = {
        bootstrapToken: { update: vi.fn(async () => ({})) },
        principal: { create: vi.fn(async () => ({ id: "principal_edge_3" })) },
        principalAlias: { create: vi.fn(async () => ({})) },
        edgeNode: { create: vi.fn(async () => ({ id: "edgenode_3" })) },
        edgeNodeCapability: {
          create: vi.fn(async () => {
            capabilityRowsCreated++;
            return {};
          }),
        },
      };
      return fn(tx);
    });

    const result = await enrollEdgeNode({
      bootstrapToken: "dpfboot_FUTURECAPS",
      displayName: "Forward-compat Edge Node",
      platform: "linux",
      installMode: "container-host",
      version: "0.1.0",
      // Agent advertises future capabilities; only discovery.network is
      // Phase 0 acceptable.
      advertisedCapabilities: [
        "discovery.network",
        "mcp.gateway",
        "a2a.gateway",
      ],
      autoApprove: true,
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.acceptedCapabilities).toEqual(["discovery.network"]);
    expect(capabilityRowsCreated).toBe(1);
  });

  it("trustState=trusted when token row.autoApprove=true and caller omits override", async () => {
    // Installer-issued token: persisted autoApprove=true. Route layer
    // doesn't pass an explicit autoApprove so the token row drives.
    tokFindUnique.mockResolvedValueOnce({
      id: "btok_installer",
      tokenHash: "hash",
      prefix: "dpfboot_inst",
      scope: "edge:enroll",
      issuedAt: new Date(),
      issuedByPrincipalId: "principal_installer",
      expiresAt: new Date(Date.now() + 60_000),
      consumedAt: null,
      consumedByEdgeNodeId: null,
      revokedAt: null,
      autoApprove: true,
    });

    let observedMode: string | undefined;
    $transaction.mockImplementation(async (fn: (tx: unknown) => Promise<unknown>) => {
      const tx = {
        bootstrapToken: { update: vi.fn(async () => ({})) },
        principal: { create: vi.fn(async () => ({ id: "principal_edge_installer" })) },
        principalAlias: { create: vi.fn(async () => ({})) },
        edgeNode: { create: vi.fn(async () => ({ id: "edgenode_installer" })) },
        edgeNodeCapability: {
          create: vi.fn(async (args: { data: { mode: string } }) => {
            observedMode = args.data.mode;
            return {};
          }),
        },
      };
      return fn(tx);
    });

    const result = await enrollEdgeNode({
      bootstrapToken: "dpfboot_INSTALLER",
      displayName: "Installer-issued node",
      platform: "linux",
      installMode: "container-host",
      version: "0.1.0",
      advertisedCapabilities: ["discovery.network"],
      // intentionally NO autoApprove field — the token row drives.
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.trustState).toBe("trusted");
    expect(observedMode).toBe("enabled");
  });

  it("trustState=pending when token row.autoApprove=false and caller omits override", async () => {
    // Paste-provisioned token: the default for remote-host enrollment.
    // No installer flag, no caller override — node must land in pending.
    tokFindUnique.mockResolvedValueOnce({
      id: "btok_paste",
      tokenHash: "hash",
      prefix: "dpfboot_paste",
      scope: "edge:enroll",
      issuedAt: new Date(),
      issuedByPrincipalId: "principal_admin",
      expiresAt: new Date(Date.now() + 60_000),
      consumedAt: null,
      consumedByEdgeNodeId: null,
      revokedAt: null,
      autoApprove: false,
    });

    $transaction.mockImplementation(async (fn: (tx: unknown) => Promise<unknown>) => {
      const tx = {
        bootstrapToken: { update: vi.fn(async () => ({})) },
        principal: { create: vi.fn(async () => ({ id: "principal_edge_paste" })) },
        principalAlias: { create: vi.fn(async () => ({})) },
        edgeNode: { create: vi.fn(async () => ({ id: "edgenode_paste" })) },
        edgeNodeCapability: { create: vi.fn(async () => ({})) },
      };
      return fn(tx);
    });

    const result = await enrollEdgeNode({
      bootstrapToken: "dpfboot_PASTED",
      displayName: "Paste-provisioned node",
      platform: "linux",
      installMode: "container-host",
      version: "0.1.0",
      advertisedCapabilities: ["discovery.network"],
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.trustState).toBe("pending");
  });

  it("explicit caller autoApprove=false overrides token row.autoApprove=true (defense in depth)", async () => {
    // Token row says auto-approve, but caller explicitly demotes it.
    // Useful for tests + future paths where the route layer wants to
    // force operator approval regardless of issuance metadata.
    tokFindUnique.mockResolvedValueOnce({
      id: "btok_override",
      tokenHash: "hash",
      prefix: "dpfboot_ov",
      scope: "edge:enroll",
      issuedAt: new Date(),
      issuedByPrincipalId: "principal_installer",
      expiresAt: new Date(Date.now() + 60_000),
      consumedAt: null,
      consumedByEdgeNodeId: null,
      revokedAt: null,
      autoApprove: true,
    });

    $transaction.mockImplementation(async (fn: (tx: unknown) => Promise<unknown>) => {
      const tx = {
        bootstrapToken: { update: vi.fn(async () => ({})) },
        principal: { create: vi.fn(async () => ({ id: "principal_edge_override" })) },
        principalAlias: { create: vi.fn(async () => ({})) },
        edgeNode: { create: vi.fn(async () => ({ id: "edgenode_override" })) },
        edgeNodeCapability: { create: vi.fn(async () => ({})) },
      };
      return fn(tx);
    });

    const result = await enrollEdgeNode({
      bootstrapToken: "dpfboot_OVERRIDE",
      displayName: "Override-demoted node",
      platform: "linux",
      installMode: "container-host",
      version: "0.1.0",
      advertisedCapabilities: ["discovery.network"],
      autoApprove: false, // caller override wins
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.trustState).toBe("pending");
  });

  it("copies bootstrap customer/site scope onto the enrolled edge node", async () => {
    tokFindUnique.mockResolvedValueOnce({
      id: "btok_scoped",
      tokenHash: "hash",
      prefix: "dpfboot_scoped",
      scope: "edge:enroll",
      issuedAt: new Date(),
      issuedByPrincipalId: "principal_installer",
      expiresAt: new Date(Date.now() + 60_000),
      consumedAt: null,
      consumedByEdgeNodeId: null,
      revokedAt: null,
      autoApprove: true,
      targetCustomerAccountId: "cust_acme",
      targetCustomerSiteId: "site_hq",
      scopePolicy: {
        ownershipScope: "customer-site",
        enforcement: "strict-customer-scope",
        source: "bootstrap-token",
        customerAccountId: "cust_acme",
        customerSiteId: "site_hq",
      },
    });

    let edgeNodeCreateData: Record<string, unknown> | undefined;
    $transaction.mockImplementation(async (fn: (tx: unknown) => Promise<unknown>) => {
      const tx = {
        bootstrapToken: { update: vi.fn(async () => ({})) },
        principal: { create: vi.fn(async () => ({ id: "principal_edge_scoped" })) },
        principalAlias: { create: vi.fn(async () => ({})) },
        edgeNode: {
          create: vi.fn(async (args: { data: Record<string, unknown> }) => {
            edgeNodeCreateData = args.data;
            return { id: "edgenode_scoped" };
          }),
        },
        edgeNodeCapability: { create: vi.fn(async () => ({})) },
      };
      return fn(tx);
    });

    const result = await enrollEdgeNode({
      bootstrapToken: "dpfboot_SCOPED",
      displayName: "Scoped node",
      platform: "linux",
      installMode: "container-host",
      version: "0.1.0",
      advertisedCapabilities: ["discovery.network"],
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(edgeNodeCreateData).toMatchObject({
      customerAccountId: "cust_acme",
      customerSiteId: "site_hq",
      scopePolicy: {
        ownershipScope: "customer-site",
        enforcement: "strict-customer-scope",
        source: "bootstrap-token",
        customerAccountId: "cust_acme",
        customerSiteId: "site_hq",
      },
    });
    expect(result.customerAccountId).toBe("cust_acme");
    expect(result.customerSiteId).toBe("site_hq");
    expect(result.scopePolicy).toMatchObject({
      ownershipScope: "customer-site",
      enforcement: "strict-customer-scope",
    });
  });
});

// ── recordHeartbeat ──────────────────────────────────────────────────────────

describe("recordHeartbeat", () => {
  it("updates lastSeenAt + status, returns intervals + accepted caps", async () => {
    let updateCalled = false;
    $transaction.mockImplementation(async (fn: (tx: unknown) => Promise<unknown>) => {
      const tx = {
        edgeNode: {
          update: vi.fn(async (args: { data: { lastSeenAt: Date; status: string } }) => {
            updateCalled = true;
            expect(args.data.lastSeenAt).toBeInstanceOf(Date);
            expect(args.data.status).toBe("active");
            return {};
          }),
        },
        edgeNodeCapability: { upsert: vi.fn(async () => ({})) },
      };
      return fn(tx);
    });
    capFindMany.mockResolvedValueOnce([{ capability: "discovery.network" }]);

    const result = await recordHeartbeat({ edgeNodeId: "edgenode_1" });

    expect(updateCalled).toBe(true);
    expect(result.acceptedCapabilities).toEqual(["discovery.network"]);
    expect(result.heartbeatIntervalSec).toBeGreaterThan(0);
    expect(result.sweepIntervalSec).toBeGreaterThan(0);
  });

  it("upserts capability rows when the agent reports them", async () => {
    let upsertedCapabilities: string[] = [];
    $transaction.mockImplementation(async (fn: (tx: unknown) => Promise<unknown>) => {
      const tx = {
        edgeNode: { update: vi.fn(async () => ({})) },
        edgeNodeCapability: {
          upsert: vi.fn(async (args: { create: { capability: string } }) => {
            upsertedCapabilities.push(args.create.capability);
            return {};
          }),
        },
      };
      return fn(tx);
    });
    capFindMany.mockResolvedValueOnce([]);

    await recordHeartbeat({
      edgeNodeId: "edgenode_1",
      capabilityReports: [
        { capability: "discovery.network", status: "healthy" },
        { capability: "metrics.host", status: "degraded" },
      ],
    });

    expect(upsertedCapabilities.sort()).toEqual([
      "discovery.network",
      "metrics.host",
    ]);
  });
});
