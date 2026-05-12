import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@dpf/db", () => ({
  prisma: {
    bootstrapToken: {
      create: vi.fn(),
      findUnique: vi.fn(),
      update: vi.fn(),
    },
    edgeNodeToken: {
      create: vi.fn(),
      findUnique: vi.fn(),
      update: vi.fn(),
      updateMany: vi.fn(),
    },
    edgeNode: {
      update: vi.fn(),
    },
    $transaction: vi.fn(),
  },
}));

import { prisma } from "@dpf/db";

import {
  consumeBootstrapToken,
  DEFAULT_NODE_SCOPES,
  EDGE_TOKEN_PREFIX,
  issueBootstrapToken,
  issueNodeToken,
  resolveNodeToken,
  revokeAllNodeTokens,
  revokeBootstrapToken,
  revokeNodeToken,
  rotateNodeToken,
} from "./tokens";

type Mock = ReturnType<typeof vi.fn>;

const bootstrapCreate = prisma.bootstrapToken.create as unknown as Mock;
const bootstrapFindUnique = prisma.bootstrapToken.findUnique as unknown as Mock;
const bootstrapUpdate = prisma.bootstrapToken.update as unknown as Mock;
const nodeTokenCreate = prisma.edgeNodeToken.create as unknown as Mock;
const nodeTokenFindUnique = prisma.edgeNodeToken.findUnique as unknown as Mock;
const nodeTokenUpdate = prisma.edgeNodeToken.update as unknown as Mock;
const nodeTokenUpdateMany = prisma.edgeNodeToken.updateMany as unknown as Mock;
const edgeNodeUpdate = prisma.edgeNode.update as unknown as Mock;
const tx = prisma.$transaction as unknown as Mock;

beforeEach(() => {
  vi.resetAllMocks();
  bootstrapCreate.mockImplementation(async ({ data }: { data: Record<string, unknown> }) => ({
    id: "boot_123",
    consumedAt: null,
    consumedByEdgeNodeId: null,
    revokedAt: null,
    revocationReason: null,
    metadata: null,
    ...data,
  }));
  nodeTokenCreate.mockImplementation(async ({ data }: { data: Record<string, unknown> }) => ({
    id: "tok_456",
    rotatedAt: null,
    revokedAt: null,
    revocationReason: null,
    lastUsedAt: null,
    ...data,
  }));
  bootstrapUpdate.mockResolvedValue({} as never);
  nodeTokenUpdate.mockResolvedValue({} as never);
  edgeNodeUpdate.mockResolvedValue({} as never);
});

afterEach(() => {
  vi.resetAllMocks();
});

describe("issueBootstrapToken", () => {
  it("returns a dpfedge_-prefixed plaintext and persists only the hash", async () => {
    const result = await issueBootstrapToken({ issuedByPrincipalId: "PRN-1" });
    expect(result.plaintext.startsWith(EDGE_TOKEN_PREFIX)).toBe(true);
    expect(result.prefix.startsWith(EDGE_TOKEN_PREFIX)).toBe(true);
    expect(result.expiresAt).toBeInstanceOf(Date);
    expect(bootstrapCreate).toHaveBeenCalledOnce();
    const data = bootstrapCreate.mock.calls[0]![0].data;
    expect(data.tokenHash).toMatch(/^[a-f0-9]{64}$/);
    expect(JSON.stringify(data)).not.toContain(result.plaintext);
    expect(data.scope).toBe("edge:enroll");
  });

  it("uses 15-minute TTL by default", async () => {
    const before = Date.now();
    const result = await issueBootstrapToken({ issuedByPrincipalId: "PRN-1" });
    const after = Date.now();
    const ttl = result.expiresAt.getTime() - before;
    expect(ttl).toBeGreaterThanOrEqual(15 * 60 * 1000 - 1);
    expect(ttl).toBeLessThanOrEqual(15 * 60 * 1000 + (after - before));
  });

  it("honors a custom ttlMs override", async () => {
    const before = Date.now();
    const result = await issueBootstrapToken({ issuedByPrincipalId: "PRN-1", ttlMs: 60_000 });
    const ttl = result.expiresAt.getTime() - before;
    expect(ttl).toBeGreaterThanOrEqual(60_000 - 1);
    expect(ttl).toBeLessThanOrEqual(60_000 + 1_000);
  });
});

describe("consumeBootstrapToken", () => {
  it("rejects non-dpfedge_ plaintext", async () => {
    const result = await consumeBootstrapToken("nottherightprefix_abc", "edge_1");
    expect(result).toEqual({ ok: false, error: "invalid_format" });
    expect(bootstrapFindUnique).not.toHaveBeenCalled();
  });

  it("rejects unknown hash", async () => {
    bootstrapFindUnique.mockResolvedValue(null);
    const result = await consumeBootstrapToken(`${EDGE_TOKEN_PREFIX}ABCDEFGHJKMN`, "edge_1");
    expect(result).toEqual({ ok: false, error: "not_found" });
  });

  it("rejects a previously revoked token", async () => {
    bootstrapFindUnique.mockResolvedValue({
      id: "boot_1",
      revokedAt: new Date(),
      consumedAt: null,
      expiresAt: new Date(Date.now() + 60_000),
    });
    const result = await consumeBootstrapToken(`${EDGE_TOKEN_PREFIX}AAAA`, "edge_1");
    expect(result).toEqual({ ok: false, error: "revoked" });
  });

  it("rejects a previously consumed token", async () => {
    bootstrapFindUnique.mockResolvedValue({
      id: "boot_1",
      revokedAt: null,
      consumedAt: new Date(),
      expiresAt: new Date(Date.now() + 60_000),
    });
    const result = await consumeBootstrapToken(`${EDGE_TOKEN_PREFIX}AAAA`, "edge_1");
    expect(result).toEqual({ ok: false, error: "already_consumed" });
  });

  it("rejects an expired token", async () => {
    bootstrapFindUnique.mockResolvedValue({
      id: "boot_1",
      revokedAt: null,
      consumedAt: null,
      expiresAt: new Date(Date.now() - 1_000),
    });
    const result = await consumeBootstrapToken(`${EDGE_TOKEN_PREFIX}AAAA`, "edge_1");
    expect(result).toEqual({ ok: false, error: "expired" });
  });

  it("succeeds and stamps consumedByEdgeNodeId on a valid token", async () => {
    bootstrapFindUnique.mockResolvedValue({
      id: "boot_1",
      revokedAt: null,
      consumedAt: null,
      expiresAt: new Date(Date.now() + 60_000),
    });
    const result = await consumeBootstrapToken(`${EDGE_TOKEN_PREFIX}AAAA`, "edge_1");
    expect(result).toEqual({ ok: true, tokenId: "boot_1" });
    expect(bootstrapUpdate).toHaveBeenCalledOnce();
    const args = bootstrapUpdate.mock.calls[0]![0];
    expect(args.where.id).toBe("boot_1");
    expect(args.data.consumedByEdgeNodeId).toBe("edge_1");
    expect(args.data.consumedAt).toBeInstanceOf(Date);
  });

  it("treats unique-violation on update as already_consumed (race protection)", async () => {
    bootstrapFindUnique.mockResolvedValue({
      id: "boot_1",
      revokedAt: null,
      consumedAt: null,
      expiresAt: new Date(Date.now() + 60_000),
    });
    bootstrapUpdate.mockRejectedValueOnce(new Error("unique violation"));
    const result = await consumeBootstrapToken(`${EDGE_TOKEN_PREFIX}AAAA`, "edge_1");
    expect(result).toEqual({ ok: false, error: "already_consumed" });
  });
});

describe("revokeBootstrapToken", () => {
  it("returns not_found when no row", async () => {
    bootstrapFindUnique.mockResolvedValue(null);
    const result = await revokeBootstrapToken("boot_x", "test");
    expect(result).toEqual({ ok: false, error: "not_found" });
  });

  it("is a no-op when already consumed", async () => {
    bootstrapFindUnique.mockResolvedValue({ revokedAt: null, consumedAt: new Date() });
    const result = await revokeBootstrapToken("boot_x", "test");
    expect(result).toEqual({ ok: true });
    expect(bootstrapUpdate).not.toHaveBeenCalled();
  });

  it("stamps revokedAt + reason on an unconsumed token", async () => {
    bootstrapFindUnique.mockResolvedValue({ revokedAt: null, consumedAt: null });
    const result = await revokeBootstrapToken("boot_x", "operator action");
    expect(result).toEqual({ ok: true });
    expect(bootstrapUpdate).toHaveBeenCalledOnce();
    const data = bootstrapUpdate.mock.calls[0]![0].data;
    expect(data.revocationReason).toBe("operator action");
    expect(data.revokedAt).toBeInstanceOf(Date);
  });
});

describe("issueNodeToken", () => {
  it("returns a dpfedge_-prefixed plaintext and persists only the hash", async () => {
    const result = await issueNodeToken({ edgeNodeId: "edge_1" });
    expect(result.plaintext.startsWith(EDGE_TOKEN_PREFIX)).toBe(true);
    expect(result.scopes).toEqual([...DEFAULT_NODE_SCOPES]);
    const data = nodeTokenCreate.mock.calls[0]![0].data;
    expect(data.tokenHash).toMatch(/^[a-f0-9]{64}$/);
    expect(JSON.stringify(data)).not.toContain(result.plaintext);
  });

  it("honors custom scopes", async () => {
    const result = await issueNodeToken({
      edgeNodeId: "edge_1",
      scopes: ["edge:heartbeat", "discovery:submit"],
    });
    expect(result.scopes).toEqual(["edge:heartbeat", "discovery:submit"]);
  });

  it("uses 24h TTL by default", async () => {
    const before = Date.now();
    const result = await issueNodeToken({ edgeNodeId: "edge_1" });
    const ttl = result.expiresAt.getTime() - before;
    expect(ttl).toBeGreaterThanOrEqual(24 * 60 * 60 * 1000 - 1);
    expect(ttl).toBeLessThanOrEqual(24 * 60 * 60 * 1000 + 1_000);
  });
});

describe("resolveNodeToken", () => {
  it("rejects non-dpfedge_ plaintext", async () => {
    const result = await resolveNodeToken("dpfmcp_AAAA");
    expect(result).toEqual({ ok: false, error: "invalid_format" });
  });

  it("rejects unknown hash", async () => {
    nodeTokenFindUnique.mockResolvedValue(null);
    const result = await resolveNodeToken(`${EDGE_TOKEN_PREFIX}AAAA`);
    expect(result).toEqual({ ok: false, error: "not_found" });
  });

  it("rejects revoked token", async () => {
    nodeTokenFindUnique.mockResolvedValue({
      id: "tok_1",
      edgeNodeId: "edge_1",
      revokedAt: new Date(),
      rotatedAt: null,
      expiresAt: new Date(Date.now() + 60_000),
      scopes: ["edge:heartbeat"],
    });
    const result = await resolveNodeToken(`${EDGE_TOKEN_PREFIX}AAAA`);
    expect(result).toEqual({ ok: false, error: "revoked" });
  });

  it("rejects expired token", async () => {
    nodeTokenFindUnique.mockResolvedValue({
      id: "tok_1",
      edgeNodeId: "edge_1",
      revokedAt: null,
      rotatedAt: null,
      expiresAt: new Date(Date.now() - 1_000),
      scopes: ["edge:heartbeat"],
    });
    const result = await resolveNodeToken(`${EDGE_TOKEN_PREFIX}AAAA`);
    expect(result).toEqual({ ok: false, error: "expired" });
  });

  it("accepts a token rotated within the grace window", async () => {
    nodeTokenFindUnique.mockResolvedValue({
      id: "tok_1",
      edgeNodeId: "edge_1",
      revokedAt: null,
      rotatedAt: new Date(Date.now() - 30 * 60_000), // 30m ago
      expiresAt: new Date(Date.now() + 60_000),
      scopes: ["edge:heartbeat", "discovery:submit"],
    });
    const result = await resolveNodeToken(`${EDGE_TOKEN_PREFIX}AAAA`);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.token.edgeNodeId).toBe("edge_1");
      expect(result.token.scopes).toEqual(["edge:heartbeat", "discovery:submit"]);
    }
  });

  it("rejects a token rotated beyond the grace window", async () => {
    nodeTokenFindUnique.mockResolvedValue({
      id: "tok_1",
      edgeNodeId: "edge_1",
      revokedAt: null,
      rotatedAt: new Date(Date.now() - 2 * 60 * 60_000), // 2h ago (> 1h default grace)
      expiresAt: new Date(Date.now() + 60_000),
      scopes: ["edge:heartbeat"],
    });
    const result = await resolveNodeToken(`${EDGE_TOKEN_PREFIX}AAAA`);
    expect(result).toEqual({ ok: false, error: "rotated_out_of_grace" });
  });

  it("succeeds and resolves edgeNodeId + scopes for an active token", async () => {
    nodeTokenFindUnique.mockResolvedValue({
      id: "tok_1",
      edgeNodeId: "edge_1",
      revokedAt: null,
      rotatedAt: null,
      expiresAt: new Date(Date.now() + 60_000),
      scopes: ["edge:heartbeat", "discovery:submit"],
    });
    const result = await resolveNodeToken(`${EDGE_TOKEN_PREFIX}AAAA`);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.token).toEqual({
        tokenId: "tok_1",
        edgeNodeId: "edge_1",
        scopes: ["edge:heartbeat", "discovery:submit"],
      });
    }
  });
});

describe("rotateNodeToken", () => {
  it("propagates resolve failures", async () => {
    nodeTokenFindUnique.mockResolvedValue(null);
    const result = await rotateNodeToken({
      currentTokenPlaintext: `${EDGE_TOKEN_PREFIX}AAAA`,
    });
    expect(result).toEqual({ ok: false, error: "not_found" });
    expect(tx).not.toHaveBeenCalled();
  });

  it("stamps rotatedAt on the old token and issues a new one inside a transaction", async () => {
    nodeTokenFindUnique.mockResolvedValue({
      id: "tok_old",
      edgeNodeId: "edge_1",
      revokedAt: null,
      rotatedAt: null,
      expiresAt: new Date(Date.now() + 60_000),
      scopes: ["edge:heartbeat", "discovery:submit"],
    });
    tx.mockImplementation(async (cb: (txClient: typeof prisma) => Promise<unknown>) => {
      return cb({
        edgeNodeToken: {
          update: vi.fn().mockResolvedValue({}),
          create: vi.fn().mockImplementation(async ({ data }) => ({ id: "tok_new", ...data })),
        },
        edgeNode: { update: vi.fn().mockResolvedValue({}) },
      } as unknown as typeof prisma);
    });

    const result = await rotateNodeToken({
      currentTokenPlaintext: `${EDGE_TOKEN_PREFIX}AAAA`,
    });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.edgeNodeId).toBe("edge_1");
      expect(result.tokenId).toBe("tok_new");
      expect(result.plaintext.startsWith(EDGE_TOKEN_PREFIX)).toBe(true);
      expect(result.scopes).toEqual(["edge:heartbeat", "discovery:submit"]);
    }
    expect(tx).toHaveBeenCalledOnce();
  });
});

describe("revokeNodeToken / revokeAllNodeTokens", () => {
  it("revokeNodeToken returns not_found when missing", async () => {
    nodeTokenFindUnique.mockResolvedValue(null);
    const result = await revokeNodeToken("tok_x", "test");
    expect(result).toEqual({ ok: false, error: "not_found" });
  });

  it("revokeNodeToken stamps revokedAt + reason", async () => {
    nodeTokenFindUnique.mockResolvedValue({ revokedAt: null });
    const result = await revokeNodeToken("tok_x", "quarantine");
    expect(result).toEqual({ ok: true });
    expect(nodeTokenUpdate).toHaveBeenCalledOnce();
    const data = nodeTokenUpdate.mock.calls[0]![0].data;
    expect(data.revocationReason).toBe("quarantine");
  });

  it("revokeAllNodeTokens scopes the update to one edge node and the not-revoked subset", async () => {
    nodeTokenUpdateMany.mockResolvedValue({ count: 3 });
    const result = await revokeAllNodeTokens("edge_1", "node revoked");
    expect(result).toEqual({ count: 3 });
    const args = nodeTokenUpdateMany.mock.calls[0]![0];
    expect(args.where).toEqual({ edgeNodeId: "edge_1", revokedAt: null });
    expect(args.data.revocationReason).toBe("node revoked");
  });
});
