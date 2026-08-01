import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@dpf/db", () => ({
  prisma: {
    $transaction: vi.fn(),
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
  acknowledgeMcpTokenRefresh,
  addScopesToMcpApiToken,
  copyMcpApiTokenPlaintext,
  issueMcpApiToken,
  listMcpApiTokens,
  resolveMcpApiToken,
  revokeMcpApiToken,
  rotateMcpApiToken,
} from "./mcp-api-token";

const tokenCreate = prisma.mcpApiToken.create as unknown as ReturnType<typeof vi.fn>;
const tokenFindUnique = prisma.mcpApiToken.findUnique as unknown as ReturnType<typeof vi.fn>;
const tokenFindMany = prisma.mcpApiToken.findMany as unknown as ReturnType<typeof vi.fn>;
const tokenUpdate = prisma.mcpApiToken.update as unknown as ReturnType<typeof vi.fn>;
const cfgFindUnique = prisma.platformDevConfig.findUnique as unknown as ReturnType<typeof vi.fn>;
const transactionMock = prisma.$transaction as unknown as ReturnType<typeof vi.fn>;

beforeEach(() => {
  vi.resetAllMocks();
  delete process.env.CONTRIBUTION_MODEL_ENABLED;
  process.env.CREDENTIAL_ENCRYPTION_KEY = "0".repeat(64);
  transactionMock.mockImplementation(async (fn) => fn(prisma));
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
  delete process.env.CREDENTIAL_ENCRYPTION_KEY;
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
    expect(data.tokenSuffix).toMatch(/^[0-9A-HJKMNP-TV-Z]{4}$/);
    expect(data.secretEnc).toMatch(/^enc:/);
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

  it("issues an admin token when requested", async () => {
    cfgFindUnique.mockResolvedValue({
      contributionMode: "selective",
      contributionModel: "fork-pr",
    });
    const result = await issueMcpApiToken({
      userId: "u1",
      name: "Mark admin",
      capability: "write",
      scope: "admin",
      scopes: ["admin_read", "admin_write"],
      expiresInDays: 30,
    });
    expect(result.ok).toBe(true);
    const data = tokenCreate.mock.calls[0]![0].data;
    expect(data.scope).toBe("admin");
    expect(data.capability).toBe("write");
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

  it("persists the coarse MCP token scope while mirroring legacy capability", async () => {
    cfgFindUnique.mockResolvedValue(null);
    const result = await issueMcpApiToken({
      userId: "u1",
      name: "Write MCP token",
      capability: "write",
      scope: "write",
      scopes: ["backlog_read", "work_capsule_write"],
      expiresInDays: 30,
    });
    if (!result.ok) throw new Error(`expected ok, got: ${result.error}`);
    const data = tokenCreate.mock.calls[0]![0].data;
    expect(data.scope).toBe("write");
    expect(data.capability).toBe("write");
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

  it("rejects unknown coarse token scope", async () => {
    const result = await issueMcpApiToken({
      userId: "u1",
      name: "x",
      capability: "write",
      scope: "owner" as never,
      scopes: ["backlog_read"],
      expiresInDays: 30,
    });
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error("unreachable");
    expect(result.error).toBe("invalid_scope");
  });

  it("issues write-capable tokens without requiring contribution-mode setup", async () => {
    cfgFindUnique.mockResolvedValue(null);
    const result = await issueMcpApiToken({
      userId: "u1",
      name: "x",
      capability: "write",
      scope: "write",
      scopes: ["backlog_write"],
      expiresInDays: 30,
    });
    expect(result.ok).toBe(true);
    expect(tokenCreate).toHaveBeenCalledOnce();
  });

  it("does not use contributionModel to block write token issuance", async () => {
    cfgFindUnique.mockResolvedValue({
      contributionMode: "selective",
      contributionModel: null,
    });
    const result = await issueMcpApiToken({
      userId: "u1",
      name: "x",
      capability: "write",
      scope: "write",
      scopes: ["backlog_write"],
      expiresInDays: 30,
    });
    expect(result.ok).toBe(true);
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
      scope: "read",
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
      scope: "read",
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
      scope: "write",
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
    expect(result?.scope).toBe("write");
    expect(result?.capability).toBe("write");
    // lastUsedAt update is fire-and-forget; allow microtask to flush
    await new Promise((r) => setImmediate(r));
    expect(tokenUpdate).toHaveBeenCalled();
  });
});

describe("acknowledgeMcpTokenRefresh", () => {
  it("acknowledges a valid replacement token and marks it used", async () => {
    tokenFindUnique.mockResolvedValue({
      id: "tok_new",
      userId: "u1",
      agentId: "AGT-100",
      scopes: ["backlog_read", "backlog_write"],
      scope: "write",
      capability: "write",
      prefix: "dpfmcp_ABCDE",
      tokenSuffix: "9K2M",
      revokedAt: null,
      expiresAt: null,
    });

    const result = await acknowledgeMcpTokenRefresh("dpfmcp_GOODTOKEN");

    expect(result).toEqual({
      ok: true,
      tokenId: "tok_new",
      prefix: "dpfmcp_ABCDE",
      tokenSuffix: "9K2M",
      scope: "write",
      capability: "write",
      scopes: ["backlog_read", "backlog_write"],
    });
    await new Promise((r) => setImmediate(r));
    expect(tokenUpdate).toHaveBeenCalledWith({
      where: { id: "tok_new" },
      data: { lastUsedAt: expect.any(Date) },
    });
  });

  it("rejects invalid refresh tokens", async () => {
    tokenFindUnique.mockResolvedValue(null);

    const result = await acknowledgeMcpTokenRefresh("dpfmcp_BAD");

    expect(result).toEqual({ ok: false, error: "invalid_token" });
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

describe("copyMcpApiTokenPlaintext", () => {
  it("decrypts recoverable token material for copy-current-token actions", async () => {
    const issued = await issueMcpApiToken({
      userId: "u1",
      name: "copyable",
      capability: "read",
      scopes: ["backlog_read"],
      expiresInDays: null,
    });
    if (!issued.ok) throw new Error("expected issue ok");
    const createdData = tokenCreate.mock.calls.at(-1)![0].data;
    tokenFindUnique.mockResolvedValue({
      id: "tok_copy",
      userId: "u1",
      prefix: issued.prefix,
      tokenSuffix: createdData.tokenSuffix,
      secretEnc: createdData.secretEnc,
      revokedAt: null,
      expiresAt: null,
    });

    const result = await copyMcpApiTokenPlaintext("tok_copy");

    expect(result).toEqual({
      ok: true,
      plaintext: issued.plaintext,
      prefix: issued.prefix,
      tokenSuffix: createdData.tokenSuffix,
    });
  });

  it("returns unavailable for legacy hash-only tokens", async () => {
    tokenFindUnique.mockResolvedValue({
      id: "tok_legacy",
      secretEnc: null,
      revokedAt: null,
      expiresAt: null,
    });

    const result = await copyMcpApiTokenPlaintext("tok_legacy");

    expect(result).toEqual({ ok: false, error: "unavailable" });
  });

  it("returns decrypt_failed when encrypted token material cannot be opened", async () => {
    const issued = await issueMcpApiToken({
      userId: "u1",
      name: "copyable",
      capability: "read",
      scopes: ["backlog_read"],
      expiresInDays: null,
    });
    if (!issued.ok) throw new Error("expected issue ok");
    const createdData = tokenCreate.mock.calls.at(-1)![0].data;
    tokenFindUnique.mockResolvedValue({
      id: "tok_copy",
      prefix: issued.prefix,
      tokenSuffix: createdData.tokenSuffix,
      secretEnc: createdData.secretEnc,
      revokedAt: null,
      expiresAt: null,
    });

    delete process.env.CREDENTIAL_ENCRYPTION_KEY;
    const result = await copyMcpApiTokenPlaintext("tok_copy");

    expect(result).toEqual({ ok: false, error: "decrypt_failed" });
  });
});

describe("rotateMcpApiToken", () => {
  it("creates a replacement token and revokes the old token in one transaction", async () => {
    tokenFindUnique.mockResolvedValue({
      id: "tok_old",
      userId: "u1",
      agentId: "AGT-100",
      name: "Mark laptop",
      scope: "write",
      capability: "write",
      scopes: ["backlog_read", "backlog_write"],
      expiresAt: new Date("2999-01-01T00:00:00Z"),
      revokedAt: null,
    });

    const result = await rotateMcpApiToken({
      tokenId: "tok_old",
      userId: "u1",
    });

    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error("expected ok");
    expect(result.plaintext).toMatch(/^dpfmcp_/);
    expect(tokenCreate).toHaveBeenCalledWith({
      data: expect.objectContaining({
        userId: "u1",
        agentId: "AGT-100",
        name: "Mark laptop (rotated)",
        scope: "write",
        capability: "write",
        scopes: ["backlog_read", "backlog_write"],
        expiresAt: new Date("2999-01-01T00:00:00Z"),
        tokenSuffix: expect.any(String),
        secretEnc: expect.stringMatching(/^enc:/),
      }),
    });
    expect(tokenUpdate).toHaveBeenCalledWith({
      where: { id: "tok_old" },
      data: {
        revokedAt: expect.any(Date),
        revokedReason: expect.stringContaining("rotated to"),
      },
    });
  });

  it("refuses to rotate tokens not owned by the user", async () => {
    tokenFindUnique.mockResolvedValue({
      id: "tok_old",
      userId: "someone_else",
      revokedAt: null,
    });

    const result = await rotateMcpApiToken({
      tokenId: "tok_old",
      userId: "u1",
    });

    expect(result).toEqual({ ok: false, error: "not_found_or_not_yours" });
    expect(tokenCreate).not.toHaveBeenCalled();
    expect(tokenUpdate).not.toHaveBeenCalled();
  });
});

describe("addScopesToMcpApiToken", () => {
  it("returns not_found when token doesn't exist", async () => {
    tokenFindUnique.mockResolvedValue(null);

    const result = await addScopesToMcpApiToken("missing", ["code_graph_read"]);

    expect(result.ok).toBe(false);
    if (result.ok) throw new Error("unreachable");
    expect(result.error).toBe("not_found");
    expect(tokenUpdate).not.toHaveBeenCalled();
  });

  it("refuses to expand revoked tokens", async () => {
    tokenFindUnique.mockResolvedValue({
      id: "tok_x",
      scopes: ["backlog_read"],
      revokedAt: new Date(),
    });

    const result = await addScopesToMcpApiToken("tok_x", ["code_graph_read"]);

    expect(result.ok).toBe(false);
    if (result.ok) throw new Error("unreachable");
    expect(result.error).toBe("revoked");
    expect(tokenUpdate).not.toHaveBeenCalled();
  });

  it("adds only missing scopes and preserves existing order", async () => {
    tokenFindUnique.mockResolvedValue({
      id: "tok_x",
      scopes: ["backlog_read", "file_read"],
      revokedAt: null,
    });

    const result = await addScopesToMcpApiToken("tok_x", [
      "code_graph_read",
      "file_read",
      "spec_plan_read",
    ]);

    expect(result).toEqual({
      ok: true,
      scopes: ["backlog_read", "file_read", "code_graph_read", "spec_plan_read"],
      addedScopes: ["code_graph_read", "spec_plan_read"],
    });
    expect(tokenUpdate).toHaveBeenCalledWith({
      where: { id: "tok_x" },
      data: {
        scopes: ["backlog_read", "file_read", "code_graph_read", "spec_plan_read"],
      },
    });
  });
});

describe("listMcpApiTokens", () => {
  it("returns rows for the given user with capability derived from scope", async () => {
    tokenFindMany.mockResolvedValue([
      {
        id: "tok_1",
        name: "x",
        prefix: "dpfmcp_X",
        scope: "admin",
        capability: "write",
        tokenSuffix: "A1B2",
        secretEnc: "enc:copyable",
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
    expect(list[0]?.scope).toBe("admin");
    expect(list[0]?.capability).toBe("write");
    expect(list[0]?.tokenSuffix).toBe("A1B2");
    expect(list[0]?.canCopy).toBe(true);
  });
});
