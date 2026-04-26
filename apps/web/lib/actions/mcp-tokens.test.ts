import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/auth", () => ({
  auth: vi.fn(),
}));

vi.mock("@/lib/auth/mcp-api-token", () => ({
  issueMcpApiToken: vi.fn(),
  revokeMcpApiToken: vi.fn(),
  listMcpApiTokens: vi.fn(),
}));

vi.mock("@/lib/tak/agent-grants", () => ({
  getToolGrantMapping: vi.fn(),
}));

import { auth } from "@/lib/auth";
import {
  issueMcpApiToken,
  listMcpApiTokens,
  revokeMcpApiToken,
} from "@/lib/auth/mcp-api-token";
import { getToolGrantMapping } from "@/lib/tak/agent-grants";
import {
  issueMyMcpToken,
  listAvailableMcpScopes,
  listMyMcpTokens,
  revokeMyMcpToken,
} from "./mcp-tokens";

const authMock = auth as unknown as ReturnType<typeof vi.fn>;
const issueMock = issueMcpApiToken as unknown as ReturnType<typeof vi.fn>;
const revokeMock = revokeMcpApiToken as unknown as ReturnType<typeof vi.fn>;
const listMock = listMcpApiTokens as unknown as ReturnType<typeof vi.fn>;
const grantMapMock = getToolGrantMapping as unknown as ReturnType<typeof vi.fn>;

beforeEach(() => {
  vi.resetAllMocks();
});

afterEach(() => {
  vi.resetAllMocks();
});

describe("listAvailableMcpScopes", () => {
  it("returns empty for unauthenticated requests", async () => {
    authMock.mockResolvedValue(null);
    const result = await listAvailableMcpScopes();
    expect(result.scopes).toEqual([]);
  });

  it("returns sorted unique grant keys when authenticated", async () => {
    authMock.mockResolvedValue({ user: { id: "u1" } });
    grantMapMock.mockReturnValue({
      tool_a: ["backlog_read", "spec_plan_read"],
      tool_b: ["backlog_write"],
      tool_c: ["backlog_read"], // duplicate
    });
    const result = await listAvailableMcpScopes();
    expect(result.scopes).toEqual(["backlog_read", "backlog_write", "spec_plan_read"]);
  });
});

describe("listMyMcpTokens", () => {
  it("rejects unauthenticated callers", async () => {
    authMock.mockResolvedValue(null);
    const result = await listMyMcpTokens();
    expect(result.ok).toBe(false);
    expect(result.tokens).toEqual([]);
  });

  it("returns serialized token list for the current user", async () => {
    authMock.mockResolvedValue({ user: { id: "u1" } });
    const now = new Date("2026-04-25T12:00:00Z");
    listMock.mockResolvedValue([
      {
        id: "tok_1",
        name: "Mark's laptop",
        prefix: "dpfmcp_ABC1",
        capability: "read",
        scopes: ["backlog_read"],
        lastUsedAt: now,
        expiresAt: null,
        revokedAt: null,
        createdAt: now,
      },
    ]);
    const result = await listMyMcpTokens();
    expect(result.ok).toBe(true);
    expect(result.tokens).toHaveLength(1);
    expect(result.tokens[0]?.lastUsedAt).toBe(now.toISOString());
    expect(result.tokens[0]?.expiresAt).toBeNull();
    expect(listMock).toHaveBeenCalledWith("u1");
  });
});

describe("issueMyMcpToken", () => {
  it("rejects unauthenticated callers", async () => {
    authMock.mockResolvedValue(null);
    const result = await issueMyMcpToken({
      name: "x",
      capability: "read",
      scopes: ["backlog_read"],
      expiresInDays: 30,
      baseUrl: "http://localhost:3000",
    });
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error("unreachable");
    expect(result.error).toBe("unauthorized");
    expect(issueMock).not.toHaveBeenCalled();
  });

  it("propagates underlying issue failures (e.g. contribution_mode_required)", async () => {
    authMock.mockResolvedValue({ user: { id: "u1" } });
    issueMock.mockResolvedValue({
      ok: false,
      error: "contribution_mode_required",
      message: "Configure contribution mode first",
    });
    const result = await issueMyMcpToken({
      name: "x",
      capability: "write",
      scopes: ["backlog_write"],
      expiresInDays: 30,
      baseUrl: "http://localhost:3000",
    });
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error("unreachable");
    expect(result.error).toBe("contribution_mode_required");
  });

  it("on success returns plaintext + setup snippets pre-filled with the token", async () => {
    authMock.mockResolvedValue({ user: { id: "u1" } });
    issueMock.mockResolvedValue({
      ok: true,
      tokenId: "tok_x",
      plaintext: "dpfmcp_SECRET",
      prefix: "dpfmcp_SECR",
      expiresAt: new Date("2026-07-25T00:00:00Z"),
    });
    const result = await issueMyMcpToken({
      name: "Mark's laptop",
      capability: "read",
      scopes: ["backlog_read"],
      expiresInDays: 90,
      baseUrl: "http://localhost:3000",
    });
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error("unreachable");
    expect(result.plaintext).toBe("dpfmcp_SECRET");
    expect(result.setupSnippets.claudeCode).toContain("http://localhost:3000/api/mcp/v1");
    expect(result.setupSnippets.claudeCode).toContain("Bearer dpfmcp_SECRET");
    expect(result.setupSnippets.vscode).toContain("Bearer dpfmcp_SECRET");
    expect(result.setupSnippets.codex).toContain("Bearer dpfmcp_SECRET");
  });
});

describe("revokeMyMcpToken", () => {
  it("rejects unauthenticated callers", async () => {
    authMock.mockResolvedValue(null);
    const result = await revokeMyMcpToken({ tokenId: "tok_x", reason: "test" });
    expect(result.ok).toBe(false);
    expect(result.error).toBe("unauthorized");
  });

  it("rejects revoke for tokens not owned by the caller", async () => {
    authMock.mockResolvedValue({ user: { id: "u1" } });
    listMock.mockResolvedValue([{ id: "tok_owned", name: "x" }]);
    const result = await revokeMyMcpToken({ tokenId: "tok_someone_else", reason: "test" });
    expect(result.ok).toBe(false);
    expect(result.error).toBe("not_found_or_not_yours");
    expect(revokeMock).not.toHaveBeenCalled();
  });

  it("revokes when the caller owns the token", async () => {
    authMock.mockResolvedValue({ user: { id: "u1" } });
    listMock.mockResolvedValue([{ id: "tok_x", name: "x" }]);
    revokeMock.mockResolvedValue({ ok: true });
    const result = await revokeMyMcpToken({ tokenId: "tok_x", reason: "leaked" });
    expect(result.ok).toBe(true);
    expect(revokeMock).toHaveBeenCalledWith("tok_x", "leaked");
  });
});
