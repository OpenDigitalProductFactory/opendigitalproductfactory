import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/auth/mcp-api-token", () => ({
  copyMcpApiTokenPlaintext: vi.fn(),
  listMcpApiTokens: vi.fn(),
}));

import {
  copyMcpApiTokenPlaintext,
  listMcpApiTokens,
} from "@/lib/auth/mcp-api-token";
import { CONTRIBUTOR_MCP_READINESS_REQUIRED_GRANTS } from "@/lib/mcp-token-scopes";
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
    scopes: [...CONTRIBUTOR_MCP_READINESS_REQUIRED_GRANTS],
    kind: "operator",
    buildId: null,
    // BI-B986A18B: the acting coworker a token speaks as; null = anonymous.
    agentId: null,
    lastUsedAt: new Date("2026-05-26T12:00:00Z"),
    expiresAt: null,
    revokedAt: null,
    createdAt: new Date("2026-05-20T12:00:00Z"),
    ...overrides,
  };
}

beforeEach(() => {
  vi.resetAllMocks();
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

  it("returns ready for an active write token with every required grant", async () => {
    listTokensMock.mockResolvedValue([token()]);

    const result = await getContributorMcpReadiness("user_1");

    expect(result.status).toBe("ready");
    expect(result.recommendedAction).toBe("test_connection");
    expect(result.identityBinding).toBe("not_available");
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
      json: async () => ({ result: { tools: [{ name: "list_backlog_items" }] } }),
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
      toolCount: 1,
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
      json: async () => ({ result: { tools: [{ name: "list_backlog_items" }] } }),
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
