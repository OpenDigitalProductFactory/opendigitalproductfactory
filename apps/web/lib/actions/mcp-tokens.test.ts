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

vi.mock("@/lib/mcp/contributor-readiness", () => ({
  getContributorMcpReadiness: vi.fn(),
}));

// BI-B986A18B: listActingCoworkerOptions reads the agent registry to offer the
// acting-coworker binding, so the action module now imports the client.
vi.mock("@dpf/db", () => ({
  prisma: {
    agentToolGrant: { findMany: vi.fn() },
  },
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
import { getContributorMcpReadiness } from "@/lib/mcp/contributor-readiness";
import { prisma } from "@dpf/db";
import {
  bulkRevokeMyMcpTokens,
  copyMyMcpToken,
  getMyContributorMcpReadiness,
  issueMyMcpToken,
  issueMyTemplateMcpToken,
  issueMyWriteMcpToken,
  listAvailableMcpScopes,
  listMcpTokenTemplates,
  listMyMcpTokens,
  revokeMyMcpToken,
  rotateMyMcpToken,
  rotateMyMcpTokenWithEdit,
  listActingCoworkerOptions,
  upgradeMyMcpTokenForCodingAgent,
} from "./mcp-tokens";

// deriveIdleDays + MCP_TOKEN_DEFAULT_STALE_DAYS moved to mcp-token-scopes.ts
// because Next.js requires every export from a "use server" module to be an
// async function (see the build error in PR review history).
import { deriveIdleDays } from "@/lib/mcp-token-scopes";

// Grant map used by the template-resolution path. Lists every grant our
// templates reference so resolveTemplateGrants() does not silently strip
// scopes when the test runs against the mocked catalog.
const FULL_GRANT_MAP: Record<string, string[]> = {
  t_a: ["architecture_read"],
  t_b: ["backlog_read"],
  t_c: ["code_graph_read"],
  t_d: ["file_read"],
  t_e: ["spec_plan_read"],
  t_f: ["work_capsule_read"],
  t_g: ["registry_read"],
  t_h: ["ea_graph_read"],
  t_i: ["thread_read"],
  t_j: ["deliberation_read"],
  t_k: ["release_plan_read"],
  t_l: ["agent_control_read"],
  t_m: ["telemetry_read"],
  t_n: ["portfolio_read"],
  t_o: ["document_read"],
  t_p: ["admin_read"],
  t_q: ["marketing_read"],
  t_r: ["consumer_read"],
  t_s: ["backlog_write"],
  t_t: ["backlog_triage"],
  t_u: ["build_promote"],
  t_v: ["build_plan_write"],
  t_w: ["work_capsule_write"],
  t_x: ["work_capsule_adopt"],
  t_y: ["sandbox_execute"],
  t_z: ["iac_execute"],
  t_aa: ["deployment_plan_create"],
  t_ab: ["release_gate_create"],
  t_ac: ["release_plan_create"],
  t_ad: ["deliberation_create"],
  t_ae: ["thread_write"],
  t_af: ["decision_record_create"],
  t_ag: ["tool_evaluation_create"],
  t_ah: ["document_write"],
  t_ai: ["ea_graph_write"],
  t_aj: ["registry_write"],
  t_ak: ["document_publish"],
  t_al: ["consumer_write"],
  t_am: ["policy_write"],
  t_an: ["financial_report_create"],
  t_ao: ["marketing_write"],
  t_ap: ["web_search"],
  t_aq: ["external_registry_search"],
  t_ar: ["data_governance_validate"],
  t_as: ["admin_write"],
  t_at: ["browser_drive"],
};

const addScopesMock = addScopesToMcpApiToken as unknown as ReturnType<typeof vi.fn>;
const authMock = auth as unknown as ReturnType<typeof vi.fn>;
const copyMock = copyMcpApiTokenPlaintext as unknown as ReturnType<typeof vi.fn>;
const issueMock = issueMcpApiToken as unknown as ReturnType<typeof vi.fn>;
const revokeMock = revokeMcpApiToken as unknown as ReturnType<typeof vi.fn>;
const listMock = listMcpApiTokens as unknown as ReturnType<typeof vi.fn>;
const rotateMock = rotateMcpApiToken as unknown as ReturnType<typeof vi.fn>;
const grantMapMock = getToolGrantMapping as unknown as ReturnType<typeof vi.fn>;
const readinessMock = getContributorMcpReadiness as unknown as ReturnType<typeof vi.fn>;

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

describe("getMyContributorMcpReadiness", () => {
  it("rejects unauthenticated callers", async () => {
    authMock.mockResolvedValue(null);

    const result = await getMyContributorMcpReadiness();

    expect(result.ok).toBe(false);
    expect(result.error).toBe("unauthorized");
    expect(readinessMock).not.toHaveBeenCalled();
  });

  it("returns contributor readiness for the current operator without plaintext", async () => {
    authMock.mockResolvedValue({ user: { id: "u1" } });
    readinessMock.mockResolvedValue({
      status: "ready",
      recommendedAction: "test_connection",
      identityBinding: "not_available",
      token: {
        id: "tok_1",
        name: "Development token",
        prefix: "dpfmcp_DEV",
        tokenSuffix: "DEV1",
        scope: "write",
        scopes: ["backlog_write"],
        lastUsedAt: null,
        expiresAt: null,
      },
      missingGrants: [],
      requiredGrants: ["backlog_write"],
      recommendedScopes: ["backlog_write"],
      probe: { status: "not_run" },
    });

    const result = await getMyContributorMcpReadiness({ probe: true });

    expect(result.ok).toBe(true);
    expect(readinessMock).toHaveBeenCalledWith("u1", {
      probe: true,
    });
    expect(JSON.stringify(result)).not.toContain("dpfmcp_SECRET");
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
  it("one-click issues a development-template token (rotation of the legacy write affordance)", async () => {
    authMock.mockResolvedValue({ user: { id: "u1" } });
    grantMapMock.mockReturnValue(FULL_GRANT_MAP);
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
        name: "Development MCP token",
        scopes: expect.arrayContaining([
          "backlog_read",
          "work_capsule_write",
          "sandbox_execute",
          "iac_execute",
        ]),
      }),
    );
  });
});

describe("listMcpTokenTemplates", () => {
  it("returns empty for unauthenticated requests", async () => {
    authMock.mockResolvedValue(null);
    const result = await listMcpTokenTemplates();
    expect(result.templates).toEqual([]);
  });

  it("returns the canonical templates with grants resolved against the install catalog", async () => {
    authMock.mockResolvedValue({ user: { id: "u1" } });
    grantMapMock.mockReturnValue(FULL_GRANT_MAP);
    const result = await listMcpTokenTemplates();
    const ids = result.templates.map((t) => t.id);
    expect(ids).toEqual([
      "admin",
      "development",
      "employee_finance",
      "employee_hr",
      "employee_ea",
      "employee_marketing",
      "observer",
      "custom",
    ]);
    const dev = result.templates.find((t) => t.id === "development");
    expect(dev?.tier).toBe("write");
    expect(dev?.grants).toEqual(expect.arrayContaining(["iac_execute", "sandbox_execute"]));
    const observer = result.templates.find((t) => t.id === "observer");
    // Observer must never carry a *_write grant.
    expect(observer?.grants.some((g) => g.endsWith("_write"))).toBe(false);
  });

  it("strips template grants that the install does not expose", async () => {
    authMock.mockResolvedValue({ user: { id: "u1" } });
    // Bare-bones catalog: only backlog_read is registered.
    grantMapMock.mockReturnValue({ tool_a: ["backlog_read"] });
    const result = await listMcpTokenTemplates();
    const finance = result.templates.find((t) => t.id === "employee_finance");
    expect(finance?.grants).toEqual(["backlog_read"]);
  });
});

describe("issueMyTemplateMcpToken", () => {
  it("rejects unauthenticated callers", async () => {
    authMock.mockResolvedValue(null);
    const result = await issueMyTemplateMcpToken({
      templateId: "development",
      name: "agent",
      expiresInDays: 90,
      baseUrl: "http://localhost:3000",
    });
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error("unreachable");
    expect(result.error).toBe("unauthorized");
    expect(issueMock).not.toHaveBeenCalled();
  });

  it("rejects unknown templates", async () => {
    authMock.mockResolvedValue({ user: { id: "u1" } });
    const result = await issueMyTemplateMcpToken({
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      templateId: "not_a_real_template" as any,
      name: "agent",
      expiresInDays: 90,
      baseUrl: "http://localhost:3000",
    });
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error("unreachable");
    expect(result.error).toBe("invalid_template");
    expect(issueMock).not.toHaveBeenCalled();
  });

  it("refuses to issue from the custom template (use issueMyMcpToken instead)", async () => {
    authMock.mockResolvedValue({ user: { id: "u1" } });
    const result = await issueMyTemplateMcpToken({
      templateId: "custom",
      name: "agent",
      expiresInDays: 90,
      baseUrl: "http://localhost:3000",
    });
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error("unreachable");
    expect(result.error).toBe("invalid_template");
  });

  it("fails when the install does not expose any of the template's grants", async () => {
    authMock.mockResolvedValue({ user: { id: "u1" } });
    grantMapMock.mockReturnValue({ tool_a: ["unrelated_grant"] });
    const result = await issueMyTemplateMcpToken({
      templateId: "employee_finance",
      name: "Finance bot",
      expiresInDays: 90,
      baseUrl: "http://localhost:3000",
    });
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error("unreachable");
    expect(result.error).toBe("no_resolvable_scopes");
    expect(issueMock).not.toHaveBeenCalled();
  });

  it("issues a finance-employee token with only finance-relevant scopes", async () => {
    authMock.mockResolvedValue({ user: { id: "u1" } });
    grantMapMock.mockReturnValue(FULL_GRANT_MAP);
    issueMock.mockResolvedValue({
      ok: true,
      tokenId: "tok_fin",
      plaintext: "dpfmcp_FIN",
      prefix: "dpfmcp_FIN1",
      tokenSuffix: "FIN1",
      expiresAt: new Date("2026-08-25T00:00:00Z"),
    });
    const result = await issueMyTemplateMcpToken({
      templateId: "employee_finance",
      name: "Finance coworker",
      expiresInDays: 90,
      baseUrl: "http://localhost:3000",
    });
    expect(result.ok).toBe(true);
    expect(issueMock).toHaveBeenCalledWith(
      expect.objectContaining({
        userId: "u1",
        scope: "write",
        capability: "write",
        name: "Finance coworker",
        scopes: expect.arrayContaining(["browser_drive", "financial_report_create", "registry_read"]),
      }),
    );
    const passed = issueMock.mock.calls[0]![0] as { scopes: string[] };
    // Finance must never carry sandbox_execute or iac_execute.
    expect(passed.scopes).not.toContain("sandbox_execute");
    expect(passed.scopes).not.toContain("iac_execute");
    expect(passed.scopes).not.toContain("admin_write");
  });

  it("issues an admin token at the admin tier with admin_write included", async () => {
    authMock.mockResolvedValue({ user: { id: "u1" } });
    grantMapMock.mockReturnValue(FULL_GRANT_MAP);
    issueMock.mockResolvedValue({
      ok: true,
      tokenId: "tok_admin",
      plaintext: "dpfmcp_ADM",
      prefix: "dpfmcp_ADM1",
      tokenSuffix: "ADM1",
      expiresAt: null,
    });
    const result = await issueMyTemplateMcpToken({
      templateId: "admin",
      name: "Platform admin",
      expiresInDays: null,
      baseUrl: "http://localhost:3000",
    });
    expect(result.ok).toBe(true);
    expect(issueMock).toHaveBeenCalledWith(
      expect.objectContaining({
        scope: "admin",
        capability: "write",
        scopes: expect.arrayContaining(["admin_write", "iac_execute"]),
      }),
    );
  });

  it("issues an observer token at the read tier with no *_write scopes", async () => {
    authMock.mockResolvedValue({ user: { id: "u1" } });
    grantMapMock.mockReturnValue(FULL_GRANT_MAP);
    issueMock.mockResolvedValue({
      ok: true,
      tokenId: "tok_obs",
      plaintext: "dpfmcp_OBS",
      prefix: "dpfmcp_OBS1",
      tokenSuffix: "OBS1",
      expiresAt: null,
    });
    const result = await issueMyTemplateMcpToken({
      templateId: "observer",
      name: "Read-only dashboard",
      expiresInDays: null,
      baseUrl: "http://localhost:3000",
    });
    expect(result.ok).toBe(true);
    expect(issueMock).toHaveBeenCalledWith(
      expect.objectContaining({
        scope: "read",
        capability: "read",
      }),
    );
    const passed = issueMock.mock.calls[0]![0] as { scopes: string[] };
    expect(passed.scopes.some((g) => g.endsWith("_write"))).toBe(false);
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
    expect(result.setupSnippets.claudeCode).toContain("http://127.0.0.1:3000/api/mcp/v1");
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

describe("deriveIdleDays", () => {
  const now = new Date("2026-05-22T12:00:00Z");

  it("returns null when the token has never been used", () => {
    expect(deriveIdleDays(null, now)).toBeNull();
    expect(deriveIdleDays(undefined, now)).toBeNull();
  });

  it("returns 0 when last-used is the same instant as now", () => {
    expect(deriveIdleDays(now, now)).toBe(0);
  });

  it("returns 0 when last-used is in the future (clock skew safety)", () => {
    expect(
      deriveIdleDays(new Date("2026-05-22T18:00:00Z"), now),
    ).toBe(0);
  });

  it("floors fractional days so a 6.5-day-old token reads as 6", () => {
    expect(
      deriveIdleDays(new Date("2026-05-16T00:00:00Z"), now),
    ).toBe(6);
  });

  it("returns the integer day count for older tokens", () => {
    expect(
      deriveIdleDays(new Date("2026-05-08T12:00:00Z"), now),
    ).toBe(14);
  });
});

describe("listMyMcpTokens — idle hygiene fields", () => {
  it("returns idleDays for active tokens and null for revoked/expired/never-used", async () => {
    authMock.mockResolvedValue({ user: { id: "u1" } });
    // Freeze time so the test isn't flaky.
    const now = new Date("2026-05-22T12:00:00Z");
    vi.useFakeTimers();
    vi.setSystemTime(now);

    listMock.mockResolvedValue([
      {
        id: "tok_active_idle_3d",
        name: "active 3d idle",
        prefix: "dpfmcp_A1",
        tokenSuffix: "AAAA",
        canCopy: true,
        capability: "write",
        scope: "write",
        scopes: ["backlog_write"],
        lastUsedAt: new Date("2026-05-19T12:00:00Z"),
        expiresAt: null,
        revokedAt: null,
        createdAt: new Date("2026-04-01T00:00:00Z"),
      },
      {
        id: "tok_active_never_used",
        name: "never used",
        prefix: "dpfmcp_B2",
        tokenSuffix: "BBBB",
        canCopy: true,
        capability: "read",
        scope: "read",
        scopes: ["backlog_read"],
        lastUsedAt: null,
        expiresAt: null,
        revokedAt: null,
        createdAt: new Date("2026-05-22T00:00:00Z"),
      },
      {
        id: "tok_revoked",
        name: "revoked",
        prefix: "dpfmcp_C3",
        tokenSuffix: "CCCC",
        canCopy: false,
        capability: "write",
        scope: "write",
        scopes: ["backlog_write"],
        lastUsedAt: new Date("2026-05-18T12:00:00Z"),
        expiresAt: null,
        revokedAt: new Date("2026-05-21T12:00:00Z"),
        createdAt: new Date("2026-04-01T00:00:00Z"),
      },
      {
        id: "tok_expired",
        name: "expired",
        prefix: "dpfmcp_D4",
        tokenSuffix: "DDDD",
        canCopy: false,
        capability: "read",
        scope: "read",
        scopes: ["backlog_read"],
        lastUsedAt: new Date("2026-05-10T12:00:00Z"),
        expiresAt: new Date("2026-05-20T12:00:00Z"),
        revokedAt: null,
        createdAt: new Date("2026-04-01T00:00:00Z"),
      },
    ]);

    const result = await listMyMcpTokens();
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error("unreachable");

    const byId = new Map(result.tokens.map((t) => [t.id, t]));
    expect(byId.get("tok_active_idle_3d")?.idleDays).toBe(3);
    expect(byId.get("tok_active_never_used")?.idleDays).toBeNull();
    expect(byId.get("tok_revoked")?.idleDays).toBeNull();
    expect(byId.get("tok_expired")?.idleDays).toBeNull();

    vi.useRealTimers();
  });
});

describe("bulkRevokeMyMcpTokens", () => {
  it("rejects unauthenticated callers", async () => {
    authMock.mockResolvedValue(null);
    const result = await bulkRevokeMyMcpTokens({ tokenIds: ["a"], reason: "x" });
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error("unreachable");
    expect(result.error).toBe("unauthorized");
    expect(revokeMock).not.toHaveBeenCalled();
  });

  it("returns an empty result set when no tokenIds are passed", async () => {
    authMock.mockResolvedValue({ user: { id: "u1" } });
    const result = await bulkRevokeMyMcpTokens({ tokenIds: [], reason: "x" });
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error("unreachable");
    expect(result.results).toEqual([]);
    expect(result.revokedCount).toBe(0);
    expect(result.failedCount).toBe(0);
    expect(listMock).not.toHaveBeenCalled();
    expect(revokeMock).not.toHaveBeenCalled();
  });

  it("deduplicates ids so a misclicked token is only revoked once", async () => {
    authMock.mockResolvedValue({ user: { id: "u1" } });
    listMock.mockResolvedValue([
      { id: "tok_x", name: "x", revokedAt: null, expiresAt: null },
    ]);
    revokeMock.mockResolvedValue({ ok: true });

    const result = await bulkRevokeMyMcpTokens({
      tokenIds: ["tok_x", "tok_x", "tok_x"],
      reason: "leaked",
    });
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error("unreachable");
    expect(revokeMock).toHaveBeenCalledTimes(1);
    expect(result.revokedCount).toBe(1);
    expect(result.failedCount).toBe(0);
  });

  it("treats already-revoked rows as idempotent successes", async () => {
    authMock.mockResolvedValue({ user: { id: "u1" } });
    listMock.mockResolvedValue([
      {
        id: "tok_already_revoked",
        name: "x",
        revokedAt: new Date("2026-05-21T00:00:00Z"),
        expiresAt: null,
      },
    ]);

    const result = await bulkRevokeMyMcpTokens({
      tokenIds: ["tok_already_revoked"],
      reason: "cleanup",
    });
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error("unreachable");
    expect(revokeMock).not.toHaveBeenCalled();
    expect(result.results[0]?.status).toBe("already_revoked");
    expect(result.revokedCount).toBe(1);
    expect(result.failedCount).toBe(0);
  });

  it("flags tokens the caller does not own as failures without touching the DB", async () => {
    authMock.mockResolvedValue({ user: { id: "u1" } });
    listMock.mockResolvedValue([{ id: "tok_mine", name: "mine", revokedAt: null, expiresAt: null }]);
    revokeMock.mockResolvedValue({ ok: true });

    const result = await bulkRevokeMyMcpTokens({
      tokenIds: ["tok_mine", "tok_someone_else"],
      reason: "cleanup",
    });
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error("unreachable");
    expect(revokeMock).toHaveBeenCalledTimes(1);
    expect(revokeMock).toHaveBeenCalledWith("tok_mine", "cleanup");
    expect(result.revokedCount).toBe(1);
    expect(result.failedCount).toBe(1);
    const failed = result.results.find((r) => r.tokenId === "tok_someone_else");
    expect(failed?.status).toBe("not_found_or_not_yours");
  });

  it("reports partial failures from the underlying revoke call", async () => {
    authMock.mockResolvedValue({ user: { id: "u1" } });
    listMock.mockResolvedValue([
      { id: "tok_a", name: "a", revokedAt: null, expiresAt: null },
      { id: "tok_b", name: "b", revokedAt: null, expiresAt: null },
    ]);
    revokeMock
      .mockResolvedValueOnce({ ok: true })
      .mockResolvedValueOnce({ ok: false, error: "db_unavailable" });

    const result = await bulkRevokeMyMcpTokens({
      tokenIds: ["tok_a", "tok_b"],
      reason: "cleanup",
    });
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error("unreachable");
    expect(result.revokedCount).toBe(1);
    expect(result.failedCount).toBe(1);
    const bResult = result.results.find((r) => r.tokenId === "tok_b");
    expect(bResult?.status).toBe("error");
    expect(bResult?.error).toBe("db_unavailable");
  });
});

describe("rotateMyMcpTokenWithEdit", () => {
  function makeOwnedToken(overrides: Partial<{
    revokedAt: Date | null;
    expiresAt: Date | null;
    name: string;
  }> = {}) {
    return {
      id: "tok_orig",
      name: overrides.name ?? "Mark laptop",
      revokedAt: overrides.revokedAt ?? null,
      expiresAt: overrides.expiresAt ?? null,
    };
  }

  it("rejects unauthenticated callers", async () => {
    authMock.mockResolvedValue(null);
    const result = await rotateMyMcpTokenWithEdit({
      tokenId: "tok_orig",
      name: "x",
      scope: "write",
      scopes: ["backlog_write"],
      expiresInDays: 90,
      baseUrl: "http://localhost:3000",
    });
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error("unreachable");
    expect(result.error).toBe("unauthorized");
    expect(issueMock).not.toHaveBeenCalled();
    expect(revokeMock).not.toHaveBeenCalled();
  });

  it("refuses an empty scopes list — a rotation without scopes is operator error", async () => {
    authMock.mockResolvedValue({ user: { id: "u1" } });
    const result = await rotateMyMcpTokenWithEdit({
      tokenId: "tok_orig",
      name: "x",
      scope: "read",
      scopes: [],
      expiresInDays: 90,
      baseUrl: "http://localhost:3000",
    });
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error("unreachable");
    expect(result.error).toBe("no_scopes");
    expect(issueMock).not.toHaveBeenCalled();
  });

  it("refuses tokens not owned by the caller", async () => {
    authMock.mockResolvedValue({ user: { id: "u1" } });
    listMock.mockResolvedValue([{ id: "tok_other", name: "x", revokedAt: null, expiresAt: null }]);
    const result = await rotateMyMcpTokenWithEdit({
      tokenId: "tok_orig",
      name: "x",
      scope: "write",
      scopes: ["backlog_write"],
      expiresInDays: 90,
      baseUrl: "http://localhost:3000",
    });
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error("unreachable");
    expect(result.error).toBe("not_found_or_not_yours");
    expect(issueMock).not.toHaveBeenCalled();
  });

  it("refuses revoked tokens — rotate is for active rows only", async () => {
    authMock.mockResolvedValue({ user: { id: "u1" } });
    listMock.mockResolvedValue([makeOwnedToken({ revokedAt: new Date("2026-05-21") })]);
    const result = await rotateMyMcpTokenWithEdit({
      tokenId: "tok_orig",
      name: "x",
      scope: "write",
      scopes: ["backlog_write"],
      expiresInDays: 90,
      baseUrl: "http://localhost:3000",
    });
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error("unreachable");
    expect(result.error).toBe("revoked");
    expect(issueMock).not.toHaveBeenCalled();
  });

  it("refuses expired tokens", async () => {
    authMock.mockResolvedValue({ user: { id: "u1" } });
    listMock.mockResolvedValue([makeOwnedToken({ expiresAt: new Date("2020-01-01") })]);
    const result = await rotateMyMcpTokenWithEdit({
      tokenId: "tok_orig",
      name: "x",
      scope: "write",
      scopes: ["backlog_write"],
      expiresInDays: 90,
      baseUrl: "http://localhost:3000",
    });
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error("unreachable");
    expect(result.error).toBe("expired");
  });

  it("issues new + revokes old in order on the happy path", async () => {
    authMock.mockResolvedValue({ user: { id: "u1" } });
    listMock.mockResolvedValue([makeOwnedToken()]);
    issueMock.mockResolvedValue({
      ok: true,
      tokenId: "tok_new",
      plaintext: "dpfmcp_NEW",
      prefix: "dpfmcp_NEW1",
      tokenSuffix: "NEW1",
      expiresAt: new Date("2026-08-22T00:00:00Z"),
    });
    revokeMock.mockResolvedValue({ ok: true });

    const result = await rotateMyMcpTokenWithEdit({
      tokenId: "tok_orig",
      name: "Mark laptop edited",
      scope: "write",
      scopes: ["backlog_read", "backlog_write", "sandbox_execute"],
      expiresInDays: 90,
      baseUrl: "http://localhost:3000",
    });
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error("unreachable");
    expect(result.oldTokenRevokeError).toBeUndefined();
    expect(issueMock).toHaveBeenCalledWith(
      expect.objectContaining({
        userId: "u1",
        name: "Mark laptop edited",
        capability: "write",
        scope: "write",
        scopes: ["backlog_read", "backlog_write", "sandbox_execute"],
      }),
    );
    expect(revokeMock).toHaveBeenCalledWith("tok_orig", "rotated with edited grants");
    // Issue must precede revoke — never leave the operator with neither.
    const issueOrder = issueMock.mock.invocationCallOrder[0]!;
    const revokeOrder = revokeMock.mock.invocationCallOrder[0]!;
    expect(issueOrder).toBeLessThan(revokeOrder);
  });

  it("falls back to the old token's name when operator leaves name blank", async () => {
    authMock.mockResolvedValue({ user: { id: "u1" } });
    listMock.mockResolvedValue([makeOwnedToken({ name: "Old name" })]);
    issueMock.mockResolvedValue({
      ok: true,
      tokenId: "tok_new",
      plaintext: "dpfmcp_NEW",
      prefix: "dpfmcp_NEW1",
      tokenSuffix: "NEW1",
      expiresAt: null,
    });
    revokeMock.mockResolvedValue({ ok: true });

    await rotateMyMcpTokenWithEdit({
      tokenId: "tok_orig",
      name: "   ",
      scope: "write",
      scopes: ["backlog_write"],
      expiresInDays: null,
      baseUrl: "http://localhost:3000",
    });
    expect(issueMock).toHaveBeenCalledWith(
      expect.objectContaining({ name: "Old name" }),
    );
  });

  it("returns the new token plus oldTokenRevokeError when revoke of old fails", async () => {
    authMock.mockResolvedValue({ user: { id: "u1" } });
    listMock.mockResolvedValue([makeOwnedToken()]);
    issueMock.mockResolvedValue({
      ok: true,
      tokenId: "tok_new",
      plaintext: "dpfmcp_NEW",
      prefix: "dpfmcp_NEW1",
      tokenSuffix: "NEW1",
      expiresAt: null,
    });
    revokeMock.mockResolvedValue({ ok: false, error: "db_locked" });

    const result = await rotateMyMcpTokenWithEdit({
      tokenId: "tok_orig",
      name: "edited",
      scope: "write",
      scopes: ["backlog_write"],
      expiresInDays: 90,
      baseUrl: "http://localhost:3000",
    });
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error("unreachable");
    expect(result.plaintext).toBe("dpfmcp_NEW");
    expect(result.oldTokenRevokeError).toBe("db_locked");
  });

  it("propagates the issue-call failure without touching revoke", async () => {
    authMock.mockResolvedValue({ user: { id: "u1" } });
    listMock.mockResolvedValue([makeOwnedToken()]);
    issueMock.mockResolvedValue({
      ok: false,
      error: "invalid_scope",
      message: "scope must be read, write, or admin",
    });

    const result = await rotateMyMcpTokenWithEdit({
      tokenId: "tok_orig",
      name: "edited",
      scope: "write",
      scopes: ["backlog_write"],
      expiresInDays: 90,
      baseUrl: "http://localhost:3000",
    });
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error("unreachable");
    expect(result.error).toBe("invalid_scope");
    // Old token must remain active when new token issuance fails.
    expect(revokeMock).not.toHaveBeenCalled();
  });
});

describe("listMyMcpTokens — revoked archive", () => {
  it("filters out tokens revoked >90 days and reports archivedCount", async () => {
    authMock.mockResolvedValue({ user: { id: "u1" } });
    const now = new Date("2026-05-22T12:00:00Z");
    vi.useFakeTimers();
    vi.setSystemTime(now);

    listMock.mockResolvedValue([
      {
        // Active token — always visible.
        id: "tok_active",
        name: "active",
        prefix: "dpfmcp_A",
        tokenSuffix: "AAAA",
        canCopy: true,
        capability: "write",
        scope: "write",
        scopes: ["backlog_write"],
        lastUsedAt: new Date("2026-05-22T00:00:00Z"),
        expiresAt: null,
        revokedAt: null,
        createdAt: new Date("2026-04-01T00:00:00Z"),
      },
      {
        // Revoked 30 days ago — within window, must remain visible (UI
        // hides via the "Show revoked" toggle separately).
        id: "tok_recent_revoke",
        name: "recent revoke",
        prefix: "dpfmcp_R",
        tokenSuffix: "RRRR",
        canCopy: false,
        capability: "write",
        scope: "write",
        scopes: ["backlog_write"],
        lastUsedAt: null,
        expiresAt: null,
        revokedAt: new Date("2026-04-22T12:00:00Z"),
        createdAt: new Date("2026-01-01T00:00:00Z"),
      },
      {
        // Revoked 120 days ago — past archive window, must be hidden.
        id: "tok_archived_1",
        name: "archived 1",
        prefix: "dpfmcp_X",
        tokenSuffix: "XXXX",
        canCopy: false,
        capability: "write",
        scope: "write",
        scopes: ["backlog_write"],
        lastUsedAt: null,
        expiresAt: null,
        revokedAt: new Date("2026-01-22T12:00:00Z"),
        createdAt: new Date("2025-10-01T00:00:00Z"),
      },
      {
        // Revoked exactly at threshold (90 days) — must be archived.
        id: "tok_archived_2",
        name: "archived 2",
        prefix: "dpfmcp_Y",
        tokenSuffix: "YYYY",
        canCopy: false,
        capability: "write",
        scope: "write",
        scopes: ["backlog_write"],
        lastUsedAt: null,
        expiresAt: null,
        revokedAt: new Date("2026-02-21T12:00:00Z"),
        createdAt: new Date("2025-10-01T00:00:00Z"),
      },
    ]);

    const result = await listMyMcpTokens();
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error("unreachable");

    const visibleIds = result.tokens.map((t) => t.id);
    expect(visibleIds).toEqual(["tok_active", "tok_recent_revoke"]);
    expect(result.archivedCount).toBe(2);

    vi.useRealTimers();
  });

  it("reports archivedCount=0 when no tokens are past the window", async () => {
    authMock.mockResolvedValue({ user: { id: "u1" } });
    listMock.mockResolvedValue([
      {
        id: "tok_x",
        name: "x",
        prefix: "dpfmcp_X",
        tokenSuffix: "XXXX",
        canCopy: true,
        capability: "read",
        scope: "read",
        scopes: ["backlog_read"],
        lastUsedAt: null,
        expiresAt: null,
        revokedAt: null,
        createdAt: new Date(),
      },
    ]);
    const result = await listMyMcpTokens();
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error("unreachable");
    expect(result.archivedCount).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// BI-B986A18B — acting-coworker binding.
//
// Every Work Room handler resolves its caller from `context.agentId`, which
// comes from the bearer token. Before this, every issuance path except
// issueMyMcpToken hardcoded `agentId: null`, so no external CLI agent could
// ever join, post to, or read a room. These guard the binding end to end.
// ---------------------------------------------------------------------------
describe("acting-coworker binding (BI-B986A18B)", () => {
  const authed = { user: { id: "user-1" } };

  beforeEach(() => {
    vi.mocked(auth).mockResolvedValue(authed as never);
    vi.mocked(getToolGrantMapping).mockReturnValue(FULL_GRANT_MAP as never);
    vi.mocked(issueMcpApiToken).mockResolvedValue({
      ok: true,
      tokenId: "tok-new",
      plaintext: "dpfmcp_secret",
      prefix: "dpfmcp_",
      tokenSuffix: "cret",
      expiresAt: null,
    } as never);
  });

  it("binds the acting coworker when a template token is issued", async () => {
    await issueMyTemplateMcpToken({
      templateId: "development",
      name: "claude-code",
      expiresInDays: 90,
      agentId: "AGT-EXT-CLAUDE",
      baseUrl: "http://localhost:3000",
    });

    expect(vi.mocked(issueMcpApiToken).mock.calls.at(-1)?.[0]).toMatchObject({
      agentId: "AGT-EXT-CLAUDE",
    });
  });

  it("leaves a template token anonymous when no coworker is chosen", async () => {
    await issueMyTemplateMcpToken({
      templateId: "development",
      name: "anonymous",
      expiresInDays: 90,
      baseUrl: "http://localhost:3000",
    });

    expect(vi.mocked(issueMcpApiToken).mock.calls.at(-1)?.[0]).toMatchObject({
      agentId: null,
    });
  });

  it("preserves the binding across rotation — the secret changes, the identity does not", async () => {
    vi.mocked(listMcpApiTokens).mockResolvedValue([
      {
        id: "tok-1",
        name: "claude-code",
        agentId: "AGT-EXT-CLAUDE",
        revokedAt: null,
        expiresAt: null,
      },
    ] as never);
    vi.mocked(revokeMcpApiToken).mockResolvedValue({ ok: true } as never);

    await rotateMyMcpTokenWithEdit({
      tokenId: "tok-1",
      name: "claude-code",
      scope: "write",
      scopes: ["backlog_read"],
      expiresInDays: 90,
      baseUrl: "http://localhost:3000",
    });

    // The regression: rotation used to hardcode null here, silently demoting a
    // room-capable token to anonymous with no error anywhere.
    expect(vi.mocked(issueMcpApiToken).mock.calls.at(-1)?.[0]).toMatchObject({
      agentId: "AGT-EXT-CLAUDE",
    });
  });

  it("offers only active coworkers that can actually act in a room", async () => {
    vi.mocked(prisma.agentToolGrant.findMany).mockResolvedValue([
      { agent: { agentId: "AGT-EXT-CODEX", name: "external-codex", displayName: "Codex (external CLI)", status: "active" } },
      { agent: { agentId: "AGT-EXT-CLAUDE", name: "external-claude-code", displayName: "Claude Code (external CLI)", status: "active" } },
      // Duplicate grant rows must not produce duplicate options.
      { agent: { agentId: "AGT-EXT-CODEX", name: "external-codex", displayName: "Codex (external CLI)", status: "active" } },
      // Retired coworkers are not offerable.
      { agent: { agentId: "AGT-OLD", name: "retired", displayName: "Retired", status: "archived" } },
      { agent: null },
    ] as never);

    const { options } = await listActingCoworkerOptions();

    expect(options.map((option) => option.agentId)).toEqual([
      "AGT-EXT-CLAUDE",
      "AGT-EXT-CODEX",
    ]);
    expect(options[0]?.label).toContain("AGT-EXT-CLAUDE");
  });

  it("offers nothing to an unauthenticated caller", async () => {
    vi.mocked(auth).mockResolvedValue(null as never);
    await expect(listActingCoworkerOptions()).resolves.toEqual({ options: [] });
  });
});
