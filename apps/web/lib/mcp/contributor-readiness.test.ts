import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/tak/agent-grants", async importOriginal => {
  const actual = await importOriginal<typeof import("@/lib/tak/agent-grants")>();
  return { ...actual, getAgentToolGrantsAsync: vi.fn() };
});
import { getAgentToolGrantsAsync } from "@/lib/tak/agent-grants";
import { DELIVERY_WORKFLOW_TOOLS } from "../../../../packages/dpf-bootstrap/src/agent-toolchain/delivery-readiness-contract";
vi.mock("@/lib/auth/mcp-api-token", () => ({
  copyMcpApiTokenPlaintext: vi.fn(),
  listMcpApiTokens: vi.fn(),
}));

import {
  copyMcpApiTokenPlaintext,
  listMcpApiTokens,
} from "@/lib/auth/mcp-api-token";
import {
  CONTRIBUTOR_MCP_READINESS_REQUIRED_GRANTS,
  getMcpTokenTemplate,
} from "@/lib/mcp-token-scopes";
import {
  _resetContributorMcpReadinessProbeCacheForTests,
  getContributorMcpReadiness,
  type ContributorMcpTokenRow,
} from "./contributor-readiness";

const listTokensMock = listMcpApiTokens as unknown as ReturnType<typeof vi.fn>;
const copyTokenMock = copyMcpApiTokenPlaintext as unknown as ReturnType<typeof vi.fn>;

function token(overrides: Partial<ContributorMcpTokenRow> = {}): ContributorMcpTokenRow {
  return {
    id: "tok_1",
    name: "Development token",
    prefix: "dpfmcp_DEV",
    tokenSuffix: "DEV1",
    canCopy: true,
    capability: "write",
    scope: "write",
    scopes: [...getMcpTokenTemplate("development")!.grants],
    kind: "operator",
    buildId: null,
    // BI-B986A18B: the acting coworker a token speaks as; null = anonymous.
    agentId: "AGT-EXT-CODEX",
    lastUsedAt: new Date("2026-05-26T12:00:00Z"),
    expiresAt: null,
    revokedAt: null,
    createdAt: new Date("2026-05-20T12:00:00Z"),
    ...overrides,
  };
}

beforeEach(() => {
  vi.resetAllMocks();
  vi.mocked(getAgentToolGrantsAsync).mockResolvedValue([...getMcpTokenTemplate("development")!.grants]);
  _resetContributorMcpReadinessProbeCacheForTests();
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

describe("getContributorMcpReadiness", () => {
  it("returns needs_authorization when the operator has no tokens", async () => {
    listTokensMock.mockResolvedValue([]);

    const result = await getContributorMcpReadiness("user_1");

    expect(result.status).toBe("needs_authorization");
    expect(result.recommendedAction).toBe("issue_development_token");
    expect(result.token).toBeNull();
    expect(result.missingGrants).toEqual([...CONTRIBUTOR_MCP_READINESS_REQUIRED_GRANTS]);
  });

  it("returns needs_reissue when every operator token is expired or revoked", async () => {
    listTokensMock.mockResolvedValue([
      token({
        id: "tok_expired",
        expiresAt: new Date("2026-05-01T00:00:00Z"),
        lastUsedAt: new Date("2026-05-10T00:00:00Z"),
      }),
      token({
        id: "tok_revoked",
        revokedAt: new Date("2026-05-20T00:00:00Z"),
        lastUsedAt: new Date("2026-05-25T00:00:00Z"),
      }),
    ]);

    const result = await getContributorMcpReadiness("user_1", {
      now: new Date("2026-05-26T12:00:00Z"),
    });

    expect(result.status).toBe("needs_reissue");
    expect(result.recommendedAction).toBe("issue_development_token");
    expect(result.token?.id).toBe("tok_revoked");
  });

  it("ignores lifecycle-managed ship tokens", async () => {
    listTokensMock.mockResolvedValue([
      token({ id: "tok_ship", kind: "ephemeral_ship", buildId: "FB-123" }),
    ]);

    const result = await getContributorMcpReadiness("user_1");

    expect(result.status).toBe("needs_authorization");
    expect(result.token).toBeNull();
  });

  it("returns needs_grants for read-tier or under-granted active tokens", async () => {
    listTokensMock.mockResolvedValue([
      token({
        id: "tok_read",
        capability: "read",
        scope: "read",
        scopes: ["architecture_read", "backlog_read"],
      }),
    ]);

    const result = await getContributorMcpReadiness("user_1");

    expect(result.status).toBe("needs_grants");
    expect(result.recommendedAction).toBe("rotate_development_token");
    expect(result.token?.id).toBe("tok_read");
    expect(result.missingGrants).toContain("backlog_write");
  });

  it("stops telling a followed-through development connection to rotate", async () => {
    const development = getMcpTokenTemplate("development")!;
    listTokensMock.mockResolvedValue([
      token({
        id: "tok_followed",
        scopes: [...development.grants],
      }),
    ]);

    const result = await getContributorMcpReadiness("user_1");

    expect(result.status).toBe("ready");
    expect(result.recommendedAction).toBe("test_connection");
    expect(result.missingGrants).toEqual([]);
  });

  it("still tells a development prefix that has not been followed through to rotate", async () => {
    const development = getMcpTokenTemplate("development")!;
    listTokensMock.mockResolvedValue([
      token({
        id: "tok_prefix",
        scopes: development.grants.slice(0, -1),
      }),
    ]);

    const result = await getContributorMcpReadiness("user_1");

    expect(result.status).toBe("needs_grants");
    expect(result.recommendedAction).toBe("rotate_development_token");
    expect(result.missingGrants).toEqual(["initiative_evidence_write"]);
  });

  it("returns ready for an active write token with every required grant", async () => {
    listTokensMock.mockResolvedValue([token()]);

    const result = await getContributorMcpReadiness("user_1");

    expect(result.status).toBe("ready");
    expect(result.recommendedAction).toBe("test_connection");
    expect(result.identityBinding).toBe("bound");
    expect(result.missingGrants).toEqual([]);
    expect(result.requiredGrants).toEqual([...CONTRIBUTOR_MCP_READINESS_REQUIRED_GRANTS]);
    expect(result.token?.id).toBe("tok_1");
  });

  it("prefers the most recently used ready token", async () => {
    listTokensMock.mockResolvedValue([
      token({ id: "tok_old", lastUsedAt: new Date("2026-05-20T12:00:00Z") }),
      token({ id: "tok_new", lastUsedAt: new Date("2026-05-26T12:00:00Z") }),
    ]);

    const result = await getContributorMcpReadiness("user_1");

    expect(result.status).toBe("ready");
    expect(result.token?.id).toBe("tok_new");
  });

  it("runs a cached read-only tools/list probe without exposing plaintext", async () => {
    listTokensMock.mockResolvedValue([token()]);
    copyTokenMock.mockResolvedValue({
      ok: true,
      plaintext: "dpfmcp_SECRET",
      prefix: "dpfmcp_SECR",
      tokenSuffix: "CRET",
    });
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ result: { structuredContent: { status: DELIVERY_WORKFLOW_TOOLS.map(name => ({ name, serverHasTool: true, tokenGranted: true, agentGranted: true, callableByName: true })) } } }),
    });
    vi.stubGlobal("fetch", fetchMock);

    const first = await getContributorMcpReadiness("user_1", {
      probe: true,
      now: new Date("2026-05-26T12:00:00Z"),
    });
    const second = await getContributorMcpReadiness("user_1", {
      probe: true,
      now: new Date("2026-05-26T12:00:30Z"),
    });

    expect(first.probe).toEqual({
      status: "success",
      checkedAt: "2026-05-26T12:00:00.000Z",
      toolCount: DELIVERY_WORKFLOW_TOOLS.length,
    });
    expect(second.probe).toEqual(first.probe);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(JSON.stringify(first)).not.toContain("dpfmcp_SECRET");
  });

  it("builds the live probe URL from server configuration only", async () => {
    vi.stubEnv("APP_URL", "https://portal.example.test/custom/path?tenant=x#fragment");
    listTokensMock.mockResolvedValue([token()]);
    copyTokenMock.mockResolvedValue({
      ok: true,
      plaintext: "dpfmcp_SECRET",
      prefix: "dpfmcp_SECR",
      tokenSuffix: "CRET",
    });
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ result: { structuredContent: { status: DELIVERY_WORKFLOW_TOOLS.map(name => ({ name, serverHasTool: true, tokenGranted: true, agentGranted: true, callableByName: true })) } } }),
    });
    vi.stubGlobal("fetch", fetchMock);

    await getContributorMcpReadiness("user_1", {
      probe: true,
      now: new Date("2026-05-26T12:00:00Z"),
    });

    expect(String(fetchMock.mock.calls[0]?.[0])).toBe(
      "https://portal.example.test/api/mcp/v1",
    );
  });

  it("caches failed probe results inside the probe window", async () => {
    listTokensMock.mockResolvedValue([token()]);
    copyTokenMock.mockResolvedValue({
      ok: true,
      plaintext: "dpfmcp_SECRET",
      prefix: "dpfmcp_SECR",
      tokenSuffix: "CRET",
    });
    const fetchMock = vi.fn().mockResolvedValue({
      ok: false,
      status: 403,
      json: async () => ({}),
    });
    vi.stubGlobal("fetch", fetchMock);

    const first = await getContributorMcpReadiness("user_1", {
      probe: true,
      now: new Date("2026-05-26T12:00:00Z"),
    });
    const second = await getContributorMcpReadiness("user_1", {
      probe: true,
      now: new Date("2026-05-26T12:00:30Z"),
    });

    expect(first.probe).toEqual({
      status: "failed",
      checkedAt: "2026-05-26T12:00:00.000Z",
      message: "HTTP 403",
    });
    expect(second.probe).toEqual(first.probe);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});

it("refuses a token-only success and names the coworker layer without suggesting token rotation", async () => {
  listTokensMock.mockResolvedValue([token()]);
  vi.mocked(getAgentToolGrantsAsync).mockResolvedValue(getMcpTokenTemplate("development")!.grants.filter(grant => !["coworker_catalog_read", "coworker_engagement_write"].includes(grant)));
  const result = await getContributorMcpReadiness("user_1");
  expect(result.status).toBe("needs_grants");
  expect(result.permissionLayer).toBe("coworker");
  expect(result.missingCoworkerTools).toEqual(["list_coworker_offers", "request_coworker_engagement"]);
  expect(result.missingTokenTools).toEqual([]);
  expect(result.recommendedAction).toBe("none");
});
it("does not establish coworker authority from an anonymous binding", async () => {
  listTokensMock.mockResolvedValue([token({ agentId: null })]);
  expect((await getContributorMcpReadiness("user_1")).status).toBe("needs_identity_binding");
});

it("does not label a tools/list-only response ready even when stored grants look complete", async () => {
  listTokensMock.mockResolvedValue([token()]);
  copyTokenMock.mockResolvedValue({ ok: true, plaintext: "synthetic-only" });
  vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: true, json: async () => ({ result: { tools: [{ name: "registry_read" }] } }) }));
  const result = await getContributorMcpReadiness("user_1", { probe: true });
  expect(result.status).not.toBe("ready");
  expect(result.probe.status).toBe("failed");
  expect(JSON.stringify(result)).not.toContain("synthetic-only");
});
