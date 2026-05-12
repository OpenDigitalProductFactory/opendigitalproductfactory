import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@dpf/db", () => ({
  prisma: {
    bootstrapToken: {
      findUnique: vi.fn(),
    },
    $transaction: vi.fn(),
  },
}));

import { prisma } from "@dpf/db";

import { enrollEdgeNode } from "./enroll";
import { EDGE_TOKEN_PREFIX } from "./tokens";

type Mock = ReturnType<typeof vi.fn>;

const bootstrapFindUnique = prisma.bootstrapToken.findUnique as unknown as Mock;
const tx = prisma.$transaction as unknown as Mock;

const validInput = {
  bootstrapTokenPlaintext: `${EDGE_TOKEN_PREFIX}AAAAAAAAAAAA`,
  displayName: "Mark's MacBook",
  platform: "darwin" as const,
  installMode: "native" as const,
  version: "0.1.0",
  capabilities: ["capability.discovery.network"],
};

beforeEach(() => {
  vi.resetAllMocks();
});

afterEach(() => {
  vi.resetAllMocks();
});

describe("enrollEdgeNode — validation", () => {
  it("rejects missing displayName as missing_fields (400)", async () => {
    const result = await enrollEdgeNode({ ...validInput, displayName: "" });
    expect(result).toEqual({ ok: false, status: 400, error: "missing_fields" });
    expect(bootstrapFindUnique).not.toHaveBeenCalled();
  });

  it("rejects unknown platform as invalid_format (400)", async () => {
    const result = await enrollEdgeNode({
      ...validInput,
      platform: "freebsd" as never,
    });
    expect(result).toEqual({ ok: false, status: 400, error: "invalid_format" });
  });

  it("rejects unknown installMode as invalid_format (400)", async () => {
    const result = await enrollEdgeNode({
      ...validInput,
      installMode: "snowflake-bespoke" as never,
    });
    expect(result).toEqual({ ok: false, status: 400, error: "invalid_format" });
  });

  it("rejects non-dpfedge_ bootstrap token as invalid_format (401)", async () => {
    const result = await enrollEdgeNode({
      ...validInput,
      bootstrapTokenPlaintext: "not_a_valid_prefix_xyz",
    });
    expect(result).toEqual({ ok: false, status: 401, error: "invalid_format" });
    expect(bootstrapFindUnique).not.toHaveBeenCalled();
  });
});

describe("enrollEdgeNode — bootstrap-token state", () => {
  it("rejects unknown bootstrap token", async () => {
    bootstrapFindUnique.mockResolvedValue(null);
    const result = await enrollEdgeNode(validInput);
    expect(result).toEqual({ ok: false, status: 401, error: "bootstrap_not_found" });
  });

  it("rejects revoked bootstrap token", async () => {
    bootstrapFindUnique.mockResolvedValue({
      id: "boot_1",
      revokedAt: new Date(),
      consumedAt: null,
      expiresAt: new Date(Date.now() + 60_000),
      metadata: null,
    });
    const result = await enrollEdgeNode(validInput);
    expect(result).toEqual({ ok: false, status: 401, error: "bootstrap_revoked" });
  });

  it("rejects already-consumed bootstrap token (409)", async () => {
    bootstrapFindUnique.mockResolvedValue({
      id: "boot_1",
      revokedAt: null,
      consumedAt: new Date(),
      expiresAt: new Date(Date.now() + 60_000),
      metadata: null,
    });
    const result = await enrollEdgeNode(validInput);
    expect(result).toEqual({ ok: false, status: 409, error: "bootstrap_already_consumed" });
  });

  it("rejects expired bootstrap token", async () => {
    bootstrapFindUnique.mockResolvedValue({
      id: "boot_1",
      revokedAt: null,
      consumedAt: null,
      expiresAt: new Date(Date.now() - 1_000),
      metadata: null,
    });
    const result = await enrollEdgeNode(validInput);
    expect(result).toEqual({ ok: false, status: 401, error: "bootstrap_expired" });
  });
});

describe("enrollEdgeNode — happy path", () => {
  function stubTransaction(overrides: { autoApprove: boolean } = { autoApprove: false }) {
    bootstrapFindUnique.mockResolvedValue({
      id: "boot_1",
      revokedAt: null,
      consumedAt: null,
      expiresAt: new Date(Date.now() + 60_000),
      metadata: overrides.autoApprove ? { autoApprove: true } : null,
    });
    tx.mockImplementation(async (cb: (txClient: typeof prisma) => Promise<unknown>) => {
      return cb({
        principal: {
          create: vi.fn().mockImplementation(async ({ data }) => ({
            id: "principal_1",
            ...data,
          })),
        },
        principalAlias: { create: vi.fn().mockResolvedValue({}) },
        edgeNode: {
          create: vi.fn().mockImplementation(async ({ data }) => ({
            id: "edge_db_1",
            ...data,
          })),
        },
        bootstrapToken: { update: vi.fn().mockResolvedValue({}) },
        edgeNodeToken: { create: vi.fn().mockResolvedValue({ id: "tok_1" }) },
      } as unknown as typeof prisma);
    });
  }

  it("returns trustState=pending without autoApprove metadata", async () => {
    stubTransaction({ autoApprove: false });
    const result = await enrollEdgeNode(validInput);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.trustState).toBe("pending");
      expect(result.nodeId).toMatch(/^edge_[a-f0-9]+$/);
      expect(result.principalId).toBe("principal_1");
      expect(result.nodeToken.plaintext.startsWith(EDGE_TOKEN_PREFIX)).toBe(true);
      expect(result.nodeToken.expiresAt).toBeInstanceOf(Date);
      expect(result.nodeToken.scopes).toContain("edge:heartbeat");
      expect(result.nodeToken.scopes).toContain("discovery:submit");
    }
  });

  it("returns trustState=trusted when bootstrap metadata.autoApprove is true", async () => {
    stubTransaction({ autoApprove: true });
    const result = await enrollEdgeNode(validInput);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.trustState).toBe("trusted");
    }
  });

  it("treats a unique-constraint race as bootstrap_already_consumed (409)", async () => {
    bootstrapFindUnique.mockResolvedValue({
      id: "boot_1",
      revokedAt: null,
      consumedAt: null,
      expiresAt: new Date(Date.now() + 60_000),
      metadata: null,
    });
    tx.mockRejectedValueOnce(new Error("Unique constraint failed on the fields: (`consumedByEdgeNodeId`)"));
    const result = await enrollEdgeNode(validInput);
    expect(result).toEqual({ ok: false, status: 409, error: "bootstrap_already_consumed" });
  });
});
