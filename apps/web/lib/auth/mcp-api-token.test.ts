import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@dpf/db", () => ({
  prisma: {
    mcpApiToken: {
      create: vi.fn(),
      findUnique: vi.fn(),
      findMany: vi.fn(),
      update: vi.fn(),
    },
    platformDevConfig: {
      findUnique: vi.fn(),
    },
  },
}));

import { prisma } from "@dpf/db";
import {
  issueMcpApiToken,
  listMcpApiTokens,
  resolveMcpApiToken,
  revokeMcpApiToken,
} from "./mcp-api-token";

const tokenCreate = prisma.mcpApiToken.create as unknown as ReturnType<typeof vi.fn>;
const tokenFindUnique = prisma.mcpApiToken.findUnique as unknown as ReturnType<typeof vi.fn>;
const tokenFindMany = prisma.mcpApiToken.findMany as unknown as ReturnType<typeof vi.fn>;
const tokenUpdate = prisma.mcpApiToken.update as unknown as ReturnType<typeof vi.fn>;
const cfgFindUnique = prisma.platformDevConfig.findUnique as unknown as ReturnType<typeof vi.fn>;

async function withFlag<T>(
  value: string | undefined,
  fn: () => Promise<T>,
): Promise<T> {
  const orig = process.env.CONTRIBUTION_MODEL_ENABLED;
  if (value === undefined) delete process.env.CONTRIBUTION_MODEL_ENABLED;
  else process.env.CONTRIBUTION_MODEL_ENABLED = value;
  try {
    // Must await inside the try so the env var is still set when the
    // contributionMode gate runs in async code.
    return await fn();
  } finally {
    if (orig === undefined) delete process.env.CONTRIBUTION_MODEL_ENABLED;
    else process.env.CONTRIBUTION_MODEL_ENABLED = orig;
  }
}

beforeEach(() => {
  vi.resetAllMocks();
  delete process.env.CONTRIBUTION_MODEL_ENABLED;
  tokenCreate.mockImplementation(async ({ data }: { data: Record<string, unknown> }) => ({
    id: "tok_123",
    createdAt: new Date(),
    revokedAt: null,
    lastUsedAt: null,
    revokedReason: null,
    ...data,
  }));
  tokenUpdate.mockResolvedValue({} as never);
});

afterEach(() => {
  vi.resetAllMocks();
  delete process.env.CONTRIBUTION_MODEL_ENABLED;
});

describe("issueMcpApiToken — happy path", () => {
  it("issues a read-only token even when contribution-mode is unset", async () => {
    cfgFindUnique.mockResolvedValue(null);
    const result = await issueMcpApiToken({
      userId: "u1",
      name: "Mark's laptop",
      capability: "read",
      scopes: ["backlog_read"],
      expiresInDays: 90,
    });
    if (!result.ok) throw new Error(`expected ok, got: ${result.error}`);
    expect(result.plaintext).toMatch(/^dpfmcp_/);
    expect(result.prefix).toMatch(/^dpfmcp_/);
    expect(result.expiresAt).toBeInstanceOf(Date);
    expect(tokenCreate).toHaveBeenCalledOnce();
    const data = tokenCreate.mock.calls[0]![0].data;
    expect(data.tokenHash).toMatch(/^[a-f0-9]{64}$/);
    expect(data.tokenHash).not.toContain(result.plaintext);
  });

  it("never persists the plaintext token", async () => {
    cfgFindUnique.mockResolvedValue(null);
    const result = await issueMcpApiToken({
      userId: "u1",
      name: "x",
      capability: "read",
      scopes: ["backlog_read"],
      expiresInDays: null,
    });
    if (!result.ok) throw new Error("expected ok");
    const data = tokenCreate.mock.calls[0]![0].data;
    expect(JSON.stringify(data)).not.toContain(result.plaintext);
  });

  it("uses null expiresAt when expiresInDays is null", async () => {
    cfgFindUnique.mockResolvedValue(null);
    const result = await issueMcpApiToken({
      userId: "u1",
      name: "forever",
      capability: "read",
      scopes: ["backlog_read"],
      expiresInDays: null,
    });
    if (!result.ok) throw new Error("expected ok");
    expect(result.expiresAt).toBeNull();
  });

  it("flag-on: issues a write token when contributionModel is set", async () => {
    cfgFindUnique.mockResolvedValue({
      contributionMode: "selective",
      contributionModel: "fork-pr",
    });
    const result = await withFlag("true", () =>
      issueMcpApiToken({
        userId: "u1",
        name: "Mark write",
        capability: "write",
        scopes: ["backlog_write"],
        expiresInDays: 30,
      }),
    );
    expect(result.ok).toBe(true);
  });

  it("flag-off: issues a write token when contributionMode is selective", async () => {
    // With the flag off, contributionModel is never written by any UI
    // surface, so the gate falls back to the user's coarse choice.
    cfgFindUnique.mockResolvedValue({
      contributionMode: "selective",
      contributionModel: null,
    });
    const result = await issueMcpApiToken({
      userId: "u1",
      name: "Mark write",
      capability: "write",
      scopes: ["backlog_write"],
      expiresInDays: 30,
    });
    expect(result.ok).toBe(true);
  });

  it("flag-off: issues a write token when contributionMode is contribute_all", async () => {
    cfgFindUnique.mockResolvedValue({
      contributionMode: "contribute_all",
      contributionModel: null,
    });
    const result = await issueMcpApiToken({
      userId: "u1",
      name: "Mark write",
      capability: "write",
      scopes: ["backlog_write"],
      expiresInDays: 30,
    });
    expect(result.ok).toBe(true);
  });

  it("generates a different token each call (cryptographic randomness)", async () => {
    cfgFindUnique.mockResolvedValue(null);
    const a = await issueMcpApiToken({
      userId: "u1",
      name: "a",
      capability: "read",
      scopes: ["backlog_read"],
      expiresInDays: 30,
    });
    const b = await issueMcpApiToken({
      userId: "u1",
      name: "b",
      capability: "read",
      scopes: ["backlog_read"],
      expiresInDays: 30,
    });
    if (!a.ok || !b.ok) throw new Error("expected ok");
    expect(a.plaintext).not.toBe(b.plaintext);
  });
});

describe("issueMcpApiToken — rejections", () => {
  it("rejects empty name", async () => {
    const result = await issueMcpApiToken({
      userId: "u1",
      name: "   ",
      capability: "read",
      scopes: ["backlog_read"],
      expiresInDays: 30,
    });
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error("unreachable");
    expect(result.error).toBe("missing_name");
    expect(tokenCreate).not.toHaveBeenCalled();
  });

  it("rejects empty scopes array", async () => {
    cfgFindUnique.mockResolvedValue(null);
    const result = await issueMcpApiToken({
      userId: "u1",
      name: "x",
      capability: "read",
      scopes: [],
      expiresInDays: 30,
    });
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error("unreachable");
    expect(result.error).toBe("empty_scopes");
  });

  it("rejects unknown capability", async () => {
    const result = await issueMcpApiToken({
      userId: "u1",
      name: "x",
      capability: "admin" as unknown as "write",
      scopes: ["backlog_read"],
      expiresInDays: 30,
    });
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error("unreachable");
    expect(result.error).toBe("invalid_capability");
  });

  it("rejects write-capable token when PlatformDevConfig row is missing", async () => {
    cfgFindUnique.mockResolvedValue(null);
    const result = await issueMcpApiToken({
      userId: "u1",
      name: "x",
      capability: "write",
      scopes: ["backlog_write"],
      expiresInDays: 30,
    });
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error("unreachable");
    expect(result.error).toBe("contribution_mode_required");
    expect(tokenCreate).not.toHaveBeenCalled();
  });

  it("flag-on: rejects write-capable token when contributionModel is null", async () => {
    cfgFindUnique.mockResolvedValue({
      contributionMode: "selective",
      contributionModel: null,
    });
    const result = await withFlag("true", () =>
      issueMcpApiToken({
        userId: "u1",
        name: "x",
        capability: "write",
        scopes: ["backlog_write"],
        expiresInDays: 30,
      }),
    );
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error("unreachable");
    expect(result.error).toBe("contribution_mode_required");
  });

  it("flag-off: rejects write-capable token when contributionMode is fork_only", async () => {
    // fork_only means "stay private" — writes have nowhere to go.
    cfgFindUnique.mockResolvedValue({
      contributionMode: "fork_only",
      contributionModel: null,
    });
    const result = await issueMcpApiToken({
      userId: "u1",
      name: "x",
      capability: "write",
      scopes: ["backlog_write"],
      expiresInDays: 30,
    });
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error("unreachable");
    expect(result.error).toBe("contribution_mode_required");
  });
});

describe("encodeBase32 invariant — token characters", () => {
  it("never contains the literal substring 'undefined' (regression — alphabet must be 32 chars)", async () => {
    cfgFindUnique.mockResolvedValue(null);
    // Mint many tokens; with the previous 30-char alphabet ~6% of characters
    // would render as "undefined", so 200 tokens would virtually guarantee a
    // hit. With a 32-char alphabet this must never happen.
    for (let i = 0; i < 200; i++) {
      const r = await issueMcpApiToken({
        userId: "u1",
        name: `t${i}`,
        capability: "read",
        scopes: ["backlog_read"],
        expiresInDays: null,
      });
      if (!r.ok) throw new Error(`mint #${i} failed: ${r.error}`);
      expect(r.plaintext).not.toContain("undefined");
    }
  });

  it("uses only Crockford base32 characters (0-9, A-Z minus I/L/O/U)", async () => {
    cfgFindUnique.mockResolvedValue(null);
    const r = await issueMcpApiToken({
      userId: "u1",
      name: "x",
      capability: "read",
      scopes: ["backlog_read"],
      expiresInDays: null,
    });
    if (!r.ok) throw new Error("expected ok");
    const secret = r.plaintext.replace(/^dpfmcp_/, "");
    expect(secret).toMatch(/^[0-9A-HJKMNP-TV-Z]+$/);
  });
});

describe("resolveMcpApiToken", () => {
  it("returns null for malformed token (no prefix)", async () => {
    const result = await resolveMcpApiToken("not-a-token");
    expect(result).toBeNull();
    expect(tokenFindUnique).not.toHaveBeenCalled();
  });

  it("returns null when no row matches", async () => {
    tokenFindUnique.mockResolvedValue(null);
    const result = await resolveMcpApiToken("dpfmcp_BOGUS123");
    expect(result).toBeNull();
  });

  it("returns null for revoked tokens", async () => {
    tokenFindUnique.mockResolvedValue({
      id: "tok_x",
      userId: "u1",
      agentId: null,
      scopes: ["backlog_read"],
      capability: "read",
      revokedAt: new Date(),
      expiresAt: null,
    });
    const result = await resolveMcpApiToken("dpfmcp_X");
    expect(result).toBeNull();
  });

  it("returns null for expired tokens", async () => {
    tokenFindUnique.mockResolvedValue({
      id: "tok_x",
      userId: "u1",
      agentId: null,
      scopes: ["backlog_read"],
      capability: "read",
      revokedAt: null,
      expiresAt: new Date(Date.now() - 1000),
    });
    const result = await resolveMcpApiToken("dpfmcp_X");
    expect(result).toBeNull();
  });

  it("returns the resolved record for a valid token and updates lastUsedAt", async () => {
    tokenFindUnique.mockResolvedValue({
      id: "tok_x",
      userId: "u1",
      agentId: "AGT-100",
      scopes: ["backlog_read", "backlog_write"],
      capability: "write",
      revokedAt: null,
      expiresAt: new Date(Date.now() + 1_000_000),
    });
    const result = await resolveMcpApiToken("dpfmcp_GOOD");
    expect(result).not.toBeNull();
    expect(result?.tokenId).toBe("tok_x");
    expect(result?.userId).toBe("u1");
    expect(result?.agentId).toBe("AGT-100");
    expect(result?.scopes).toEqual(["backlog_read", "backlog_write"]);
    expect(result?.capability).toBe("write");
    // lastUsedAt update is fire-and-forget; allow microtask to flush
    await new Promise((r) => setImmediate(r));
    expect(tokenUpdate).toHaveBeenCalled();
  });
});

describe("revokeMcpApiToken", () => {
  it("returns not_found when token doesn't exist", async () => {
    tokenFindUnique.mockResolvedValue(null);
    const result = await revokeMcpApiToken("nope", "test");
    expect(result.ok).toBe(false);
    expect(result.error).toBe("not_found");
  });

  it("is idempotent — already-revoked returns ok without re-revoking", async () => {
    tokenFindUnique.mockResolvedValue({ revokedAt: new Date() });
    const result = await revokeMcpApiToken("tok_x", "test");
    expect(result.ok).toBe(true);
    expect(tokenUpdate).not.toHaveBeenCalled();
  });

  it("revokes an active token with the given reason", async () => {
    tokenFindUnique.mockResolvedValue({ revokedAt: null });
    const result = await revokeMcpApiToken("tok_x", "leaked");
    expect(result.ok).toBe(true);
    expect(tokenUpdate).toHaveBeenCalledWith({
      where: { id: "tok_x" },
      data: { revokedAt: expect.any(Date), revokedReason: "leaked" },
    });
  });
});

describe("listMcpApiTokens", () => {
  it("returns rows for the given user with capability defaulted", async () => {
    tokenFindMany.mockResolvedValue([
      {
        id: "tok_1",
        name: "x",
        prefix: "dpfmcp_X",
        capability: "read",
        scopes: ["backlog_read"],
        lastUsedAt: null,
        expiresAt: null,
        revokedAt: null,
        createdAt: new Date(),
      },
    ]);
    const list = await listMcpApiTokens("u1");
    expect(list).toHaveLength(1);
    expect(list[0]?.id).toBe("tok_1");
    expect(list[0]?.capability).toBe("read");
  });
});
