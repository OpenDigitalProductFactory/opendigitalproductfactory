import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/auth", () => ({
  auth: vi.fn(),
}));

vi.mock("@/lib/auth/mcp-api-token", () => ({
  addScopesToMcpApiToken: vi.fn(),
  copyMcpApiTokenPlaintext: vi.fn(),
  issueMcpApiToken: vi.fn(),
  revokeMcpApiToken: vi.fn(),
  listMcpApiTokens: vi.fn(),
  rotateMcpApiToken: vi.fn(),
}));

vi.mock("@/lib/tak/agent-grants", () => ({
  getToolGrantMapping: vi.fn(),
}));

import { auth } from "@/lib/auth";
import {
  addScopesToMcpApiToken,
  copyMcpApiTokenPlaintext,
  issueMcpApiToken,
  listMcpApiTokens,
  revokeMcpApiToken,
  rotateMcpApiToken,
} from "@/lib/auth/mcp-api-token";
import { getToolGrantMapping } from "@/lib/tak/agent-grants";
import {
  copyMyMcpToken,
  issueMyMcpToken,
  issueMyWriteMcpToken,
  listAvailableMcpScopes,
  listMyMcpTokens,
  revokeMyMcpToken,
  rotateMyMcpToken,
  upgradeMyMcpTokenForCodingAgent,
} from "./mcp-tokens";

const addScopesMock = addScopesToMcpApiToken as unknown as ReturnType<typeof vi.fn>;
const authMock = auth as unknown as ReturnType<typeof vi.fn>;
const copyMock = copyMcpApiTokenPlaintext as unknown as ReturnType<typeof vi.fn>;
const issueMock = issueMcpApiToken as unknown as ReturnType<typeof vi.fn>;
const revokeMock = revokeMcpApiToken as unknown as ReturnType<typeof vi.fn>;
const listMock = listMcpApiTokens as unknown as ReturnType<typeof vi.fn>;
const rotateMock = rotateMcpApiToken as unknown as ReturnType<typeof vi.fn>;
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
      tool_d: ["code_graph_read"],
    });
    const result = await listAvailableMcpScopes();
    expect(result.scopes).toEqual([
      "backlog_read",
      "backlog_write",
      "code_graph_read",
      "spec_plan_read",
    ]);
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
        tokenSuffix: "9K2M",
        canCopy: true,
        capability: "read",
        scope: "read",
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
    expect(result.tokens[0]?.tokenSuffix).toBe("9K2M");
    expect(result.tokens[0]?.canCopy).toBe(true);
    expect(listMock).toHaveBeenCalledWith("u1");
  });
});

describe("issueMyWriteMcpToken", () => {
  it("one-click issues a write-scoped token with the standard write grant set", async () => {
    authMock.mockResolvedValue({ user: { id: "u1" } });
    issueMock.mockResolvedValue({
      ok: true,
      tokenId: "tok_write",
      plaintext: "dpfmcp_WRITE",
      prefix: "dpfmcp_WRIT",
      tokenSuffix: "W1TE",
      expiresAt: new Date("2026-07-25T00:00:00Z"),
    });

    const result = await issueMyWriteMcpToken({
      baseUrl: "http://localhost:3000",
    });

    expect(result.ok).toBe(true);
    expect(issueMock).toHaveBeenCalledWith(
      expect.objectContaining({
        userId: "u1",
        capability: "write",
        scope: "write",
        name: "Write MCP token",
        scopes: expect.arrayContaining(["backlog_read", "work_capsule_write"]),
      }),
    );
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

  it("propagates underlying issue failures", async () => {
    authMock.mockResolvedValue({ user: { id: "u1" } });
    issueMock.mockResolvedValue({
      ok: false,
      error: "invalid_scope",
      message: "scope must be read, write, or admin",
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
    expect(result.error).toBe("invalid_scope");
  });

  it("on success returns plaintext plus env-backed setup and refresh snippets", async () => {
    authMock.mockResolvedValue({ user: { id: "u1" } });
    issueMock.mockResolvedValue({
      ok: true,
      tokenId: "tok_x",
      plaintext: "dpfmcp_SECRET",
      prefix: "dpfmcp_SECR",
      tokenSuffix: "CRET",
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
    expect(result.setupSnippets.claudeCode).toContain("Bearer ${DPF_MCP_BEARER_TOKEN}");
    expect(result.setupSnippets.vscode).toContain("Bearer ${env:DPF_MCP_BEARER_TOKEN}");
    expect(result.setupSnippets.codex).toContain('bearer_token_env_var = "DPF_MCP_BEARER_TOKEN"');
    expect(result.setupSnippets.claudeCode).not.toContain("dpfmcp_SECRET");
    expect(result.setupSnippets.envPowerShell).toContain("dpfmcp_SECRET");
    expect(result.setupSnippets.runtimeRefreshPowerShell).toContain("/api/mcp/token/refresh");
    const claudeCode = JSON.parse(result.setupSnippets.claudeCode);
    const vscode = JSON.parse(result.setupSnippets.vscode);
    expect(claudeCode.mcpServers.dpf.type).toBe("http");
    expect(vscode.servers.dpf.type).toBe("http");
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

describe("copyMyMcpToken", () => {
  it("rejects unauthenticated callers", async () => {
    authMock.mockResolvedValue(null);

    const result = await copyMyMcpToken({
      tokenId: "tok_x",
      baseUrl: "http://localhost:3000",
    });

    expect(result.ok).toBe(false);
    if (result.ok) throw new Error("unreachable");
    expect(result.error).toBe("unauthorized");
    expect(copyMock).not.toHaveBeenCalled();
  });

  it("rejects copy for tokens not owned by the caller", async () => {
    authMock.mockResolvedValue({ user: { id: "u1" } });
    listMock.mockResolvedValue([{ id: "tok_owned", name: "x" }]);

    const result = await copyMyMcpToken({
      tokenId: "tok_other",
      baseUrl: "http://localhost:3000",
    });

    expect(result.ok).toBe(false);
    if (result.ok) throw new Error("unreachable");
    expect(result.error).toBe("not_found_or_not_yours");
    expect(copyMock).not.toHaveBeenCalled();
  });

  it("returns plaintext and setup snippets for an owned recoverable token", async () => {
    authMock.mockResolvedValue({ user: { id: "u1" } });
    listMock.mockResolvedValue([{ id: "tok_x", name: "x", revokedAt: null, expiresAt: null }]);
    copyMock.mockResolvedValue({
      ok: true,
      plaintext: "dpfmcp_SECRET",
      prefix: "dpfmcp_SECR",
      tokenSuffix: "A1B2",
    });

    const result = await copyMyMcpToken({
      tokenId: "tok_x",
      baseUrl: "http://localhost:3000",
    });

    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error("unreachable");
    expect(result.plaintext).toBe("dpfmcp_SECRET");
    expect(result.setupSnippets.claudeCode).toContain("Bearer ${DPF_MCP_BEARER_TOKEN}");
    expect(result.setupSnippets.envPowerShell).toContain("dpfmcp_SECRET");
  });
});

describe("rotateMyMcpToken", () => {
  it("rejects unauthenticated callers", async () => {
    authMock.mockResolvedValue(null);

    const result = await rotateMyMcpToken({
      tokenId: "tok_x",
      baseUrl: "http://localhost:3000",
    });

    expect(result.ok).toBe(false);
    if (result.ok) throw new Error("unreachable");
    expect(result.error).toBe("unauthorized");
    expect(rotateMock).not.toHaveBeenCalled();
  });

  it("returns replacement plaintext and setup snippets after rotating an owned token", async () => {
    authMock.mockResolvedValue({ user: { id: "u1" } });
    rotateMock.mockResolvedValue({
      ok: true,
      tokenId: "tok_new",
      plaintext: "dpfmcp_NEWSECRET",
      prefix: "dpfmcp_NEWS",
      tokenSuffix: "C3D4",
      expiresAt: new Date("2026-08-01T00:00:00Z"),
      revokedTokenId: "tok_old",
    });

    const result = await rotateMyMcpToken({
      tokenId: "tok_old",
      baseUrl: "http://localhost:3000",
    });

    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error("unreachable");
    expect(rotateMock).toHaveBeenCalledWith({ tokenId: "tok_old", userId: "u1" });
    expect(result.tokenId).toBe("tok_new");
    expect(result.plaintext).toBe("dpfmcp_NEWSECRET");
    expect(result.setupSnippets.codex).toContain('bearer_token_env_var = "DPF_MCP_BEARER_TOKEN"');
    expect(result.setupSnippets.envPowerShell).toContain("dpfmcp_NEWSECRET");
    expect(result.setupSnippets.runtimeRefreshPowerShell).toContain("dpfmcp_NEWSECRET");
  });
});

describe("upgradeMyMcpTokenForCodingAgent", () => {
  it("rejects unauthenticated callers", async () => {
    authMock.mockResolvedValue(null);

    const result = await upgradeMyMcpTokenForCodingAgent({ tokenId: "tok_x" });

    expect(result.ok).toBe(false);
    if (result.ok) throw new Error("unreachable");
    expect(result.error).toBe("unauthorized");
    expect(addScopesMock).not.toHaveBeenCalled();
  });

  it("rejects tokens not owned by the caller", async () => {
    authMock.mockResolvedValue({ user: { id: "u1" } });
    listMock.mockResolvedValue([{ id: "tok_owned", name: "x", revokedAt: null, expiresAt: null }]);

    const result = await upgradeMyMcpTokenForCodingAgent({ tokenId: "tok_other" });

    expect(result.ok).toBe(false);
    if (result.ok) throw new Error("unreachable");
    expect(result.error).toBe("not_found_or_not_yours");
    expect(addScopesMock).not.toHaveBeenCalled();
  });

  it("adds the default coding-agent scopes to an existing token", async () => {
    authMock.mockResolvedValue({ user: { id: "u1" } });
    listMock.mockResolvedValue([
      {
        id: "tok_x",
        name: "Mark laptop",
        scopes: ["backlog_read"],
        revokedAt: null,
        expiresAt: null,
      },
    ]);
    addScopesMock.mockResolvedValue({
      ok: true,
      scopes: [
        "backlog_read",
        "architecture_read",
        "code_graph_read",
        "file_read",
        "spec_plan_read",
        "work_capsule_read",
      ],
      addedScopes: [
        "architecture_read",
        "code_graph_read",
        "file_read",
        "spec_plan_read",
        "work_capsule_read",
      ],
    });

    const result = await upgradeMyMcpTokenForCodingAgent({ tokenId: "tok_x" });

    expect(result.ok).toBe(true);
    expect(addScopesMock).toHaveBeenCalledWith("tok_x", [
      "architecture_read",
      "backlog_read",
      "code_graph_read",
      "file_read",
      "spec_plan_read",
      "work_capsule_read",
    ]);
  });
});
