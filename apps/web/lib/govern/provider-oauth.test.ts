import { beforeEach, describe, expect, it, vi } from "vitest";

const { mockPrisma, mockAutoDiscoverAndProfile, mockRefreshDefaultOwners } = vi.hoisted(() => ({
  mockPrisma: {
    aiProviderConnection: { findUnique: vi.fn(), update: vi.fn(), updateMany: vi.fn() },
    complianceEvidence: { updateMany: vi.fn() },
    $transaction: vi.fn(),
    oAuthPendingFlow: {
      findUnique: vi.fn(),
      delete: vi.fn(),
      create: vi.fn(),
      deleteMany: vi.fn(),
    },
    modelProvider: {
      findUnique: vi.fn(),
      update: vi.fn(),
      updateMany: vi.fn(),
    },
    credentialEntry: {
      upsert: vi.fn(),
      findUnique: vi.fn(),
      update: vi.fn(),
      updateMany: vi.fn(),
    },
    mcpServer: {
      findMany: vi.fn(),
      update: vi.fn(),
    },
  },
  mockAutoDiscoverAndProfile: vi.fn(),
  mockRefreshDefaultOwners: vi.fn(),
}));

vi.mock("@dpf/db", () => ({
  prisma: mockPrisma,
  refreshDefaultProviderConnectionOwners: mockRefreshDefaultOwners,
}));

vi.mock("@/lib/credential-crypto", () => ({
  encryptSecret: vi.fn((value: string) => `enc:${value}`),
  decryptSecret: vi.fn((value: string | null) =>
    typeof value === "string" ? value.replace(/^enc:/, "") : null,
  ),
}));

vi.mock("@/lib/ai-provider-internals", () => ({
  autoDiscoverAndProfile: mockAutoDiscoverAndProfile,
}));

import {
  buildProviderOAuthErrorPath,
  createOAuthFlow,
  exchangeOAuthCode,
  findPendingOAuthProviderId,
  refreshOAuthToken,
} from "./provider-oauth";

describe("createOAuthFlow", () => {
  beforeEach(() => {
    vi.clearAllMocks();

    mockPrisma.oAuthPendingFlow.deleteMany.mockResolvedValue({ count: 0 });
    mockPrisma.oAuthPendingFlow.create.mockResolvedValue({});
    mockPrisma.credentialEntry.findUnique.mockResolvedValue(null);

    mockPrisma.modelProvider.findUnique.mockImplementation(
      async ({ where }: { where: { providerId: string } }) => {
        if (where.providerId === "codex") {
          return {
            providerId: "codex",
            authorizeUrl: "https://auth.openai.com/oauth/authorize",
            oauthClientId: "client-codex",
            oauthRedirectUri: null,
          };
        }
        if (where.providerId === "chatgpt") {
          return {
            providerId: "chatgpt",
            authorizeUrl: "https://auth.openai.com/oauth/authorize",
            oauthClientId: "client-chatgpt",
            oauthRedirectUri: null,
          };
        }
        return null;
      },
    );
  });

  // BI-46461599: without offline_access OpenAI issues no refresh token, so the
  // provider dies at first expiry. The Codex CLI's own login (same public
  // client) requests these scopes.
  it("requests offline_access by default for Codex OAuth flows", async () => {
    const result = await createOAuthFlow("codex");

    expect(result).toHaveProperty("authorizeUrl");
    const url = new URL((result as { authorizeUrl: string }).authorizeUrl);
    expect(url.searchParams.get("scope")).toBe("openid profile email offline_access");
  });

  it("binds concurrent same-provider sign-ins to their own account identities", async () => {
    mockPrisma.aiProviderConnection.findUnique.mockImplementation(async ({ where }) => ({ providerId: "codex", credentialEntry: { id: where.connectionId } }));
    await createOAuthFlow("codex", "account-a");
    await createOAuthFlow("codex", "account-b");
    const flows = mockPrisma.oAuthPendingFlow.create.mock.calls.map(([args]) => args.data);
    expect(flows.map((flow) => flow.connectionId)).toEqual(["account-a", "account-b"]);
    expect(flows[0].state).not.toBe(flows[1].state);
  });

  it("requests offline_access by default for ChatGPT OAuth flows", async () => {
    const result = await createOAuthFlow("chatgpt");

    const url = new URL((result as { authorizeUrl: string }).authorizeUrl);
    expect(url.searchParams.get("scope")).toBe("openid profile email offline_access");
  });

  it("adds no default scope for providers outside auth.openai.com", async () => {
    mockPrisma.modelProvider.findUnique.mockResolvedValue({
      providerId: "other",
      authorizeUrl: "https://auth.openai.com.evil.example/oauth/authorize",
      oauthClientId: "client-other",
      oauthRedirectUri: null,
    });

    const result = await createOAuthFlow("other");

    const url = new URL((result as { authorizeUrl: string }).authorizeUrl);
    expect(url.searchParams.get("scope")).toBeNull();
  });

  it("preserves configured OAuth scopes without adding new defaults", async () => {
    mockPrisma.credentialEntry.findUnique.mockResolvedValue({
      providerId: "chatgpt",
      scope: "openid profile",
    });

    const result = await createOAuthFlow("chatgpt");

    expect(result).toHaveProperty("authorizeUrl");
    const url = new URL((result as { authorizeUrl: string }).authorizeUrl);
    expect(url.searchParams.get("scope")).toBe("openid profile");
  });

  // Regression guard for ChatGPT OAuth `unknown_error` on auth.openai.com.
  // When the provider row carries an explicit oauthRedirectUri (set in the
  // seed to match the OAuth client's registered whitelist), the authorize URL
  // must send that exact value — not the long-path computed fallback.
  // See docs/triage/2026-05-23-chatgpt-oauth-unknown-error.md.
  it("sends the provider's explicit oauthRedirectUri verbatim in the authorize URL", async () => {
    mockPrisma.modelProvider.findUnique.mockResolvedValue({
      providerId: "chatgpt",
      authorizeUrl: "https://auth.openai.com/oauth/authorize",
      oauthClientId: "app_EMoamEEZ73f0CkXaXp7hrann",
      oauthRedirectUri: "http://localhost:1455/auth/callback",
    });

    const result = await createOAuthFlow("chatgpt");

    expect(result).toHaveProperty("authorizeUrl");
    const url = new URL((result as { authorizeUrl: string }).authorizeUrl);
    expect(url.searchParams.get("redirect_uri")).toBe("http://localhost:1455/auth/callback");
  });
});

describe("exchangeOAuthCode", () => {
  beforeEach(() => {
    vi.clearAllMocks();

    mockPrisma.oAuthPendingFlow.findUnique.mockResolvedValue({
      id: "flow-1",
      state: "state-1",
      codeVerifier: "verifier",
      providerId: "codex",
      createdAt: new Date(),
    });
    mockPrisma.oAuthPendingFlow.delete.mockResolvedValue({});
    mockPrisma.oAuthPendingFlow.deleteMany.mockResolvedValue({ count: 1 });
    mockPrisma.$transaction.mockImplementation((fn) => fn(mockPrisma));
    mockPrisma.modelProvider.update.mockResolvedValue({});
    mockPrisma.modelProvider.updateMany.mockResolvedValue({ count: 1 });
    mockPrisma.credentialEntry.upsert.mockResolvedValue({});
    mockPrisma.credentialEntry.findUnique.mockResolvedValue(null);
    mockPrisma.aiProviderConnection.findUnique.mockImplementation(async ({ where }) => ({
      id: `db-${where.connectionId}`, connectionId: where.connectionId,
      providerId: where.connectionId.replace("provider-default-", ""), credentialEntryId: null,
    }));
    mockPrisma.mcpServer.findMany.mockResolvedValue([]);
    mockAutoDiscoverAndProfile.mockResolvedValue({ discovered: 2, profiled: 2 });

    mockPrisma.modelProvider.findUnique.mockImplementation(
      async ({ where }: { where: { providerId: string } }) => {
        if (where.providerId === "codex") {
          return {
            providerId: "codex",
            tokenUrl: "https://auth.openai.com/oauth/token",
            oauthClientId: "client-codex",
            authorizeUrl: "https://auth.openai.com/oauth/authorize",
          };
        }
        if (where.providerId === "chatgpt") {
          return {
            providerId: "chatgpt",
            tokenUrl: "https://auth.openai.com/oauth/token",
            oauthClientId: "client-chatgpt",
            authorizeUrl: "https://auth.openai.com/oauth/authorize",
          };
        }
        return null;
      },
    );

    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({
          access_token: "access-token",
          refresh_token: "refresh-token",
          expires_in: 3600,
        }),
      }),
    );
  });

  it("triggers reconciliation for the activated provider and OpenAI sibling", async () => {
    const result = await exchangeOAuthCode("state-1", "code-1");

    expect(result).toEqual({ providerId: "codex" });
    expect(mockAutoDiscoverAndProfile).toHaveBeenCalledWith("codex");
    expect(mockAutoDiscoverAndProfile).toHaveBeenCalledWith("chatgpt");
    expect(mockRefreshDefaultOwners).toHaveBeenCalledWith(mockPrisma, "codex", { credentialReplaced: true });
    expect(mockRefreshDefaultOwners).toHaveBeenCalledWith(mockPrisma, "chatgpt", { credentialReplaced: true });
  });

  it("clears both default accounts' old trust before fresh credentials are activated", async () => {
    await exchangeOAuthCode("state-1", "code-1");
    for (const providerId of ["codex", "chatgpt"]) {
      expect(mockPrisma.aiProviderConnection.update).toHaveBeenCalledWith(expect.objectContaining({
        where: expect.objectContaining({ connectionId: `provider-default-${providerId}` }),
        data: expect.objectContaining({ accountClass: "unknown", evidenceStatus: "unreviewed", entitlements: {}, modelsVerifiedAt: null, accessibleModelIds: [] }),
      }));
      expect(mockPrisma.complianceEvidence.updateMany).toHaveBeenCalledWith({
        where: { providerConnectionId: `db-provider-default-${providerId}`, claimKey: { not: null }, status: "active" },
        data: { status: "superseded" },
      });
    }
    expect(Math.max(...mockPrisma.aiProviderConnection.update.mock.invocationCallOrder))
      .toBeLessThan(Math.min(...mockPrisma.modelProvider.update.mock.invocationCallOrder));
    expect(Math.max(...mockPrisma.credentialEntry.upsert.mock.invocationCallOrder))
      .toBeLessThan(Math.min(...mockAutoDiscoverAndProfile.mock.invocationCallOrder));
  });

  it("refuses a default flow whose legacy credential belongs to an additional account", async () => {
    mockPrisma.credentialEntry.findUnique.mockResolvedValue({ id: "credential-b", providerConnection: { connectionId: "account-b" } });
    expect(await exchangeOAuthCode("state-1", "code-1")).toEqual({ error: "account_changed" });
    expect(mockPrisma.credentialEntry.upsert).not.toHaveBeenCalled();
    expect(mockPrisma.aiProviderConnection.update).not.toHaveBeenCalled();
    expect(mockAutoDiscoverAndProfile).not.toHaveBeenCalled();
  });

  it("validates the sibling owner before changing either shared default account", async () => {
    mockPrisma.credentialEntry.findUnique.mockImplementation(async ({ where }) => where.providerId === "chatgpt"
      ? { id: "foreign", providerConnection: { connectionId: "account-b" } } : null);
    expect(await exchangeOAuthCode("state-1", "code-1")).toEqual({ error: "account_changed" });
    expect(mockPrisma.credentialEntry.upsert).not.toHaveBeenCalled();
    expect(mockPrisma.complianceEvidence.updateMany).not.toHaveBeenCalled();
  });

  it("does not activate a disabled default account while clearing its obsolete claims", async () => {
    mockPrisma.aiProviderConnection.findUnique.mockImplementation(async ({ where }) => ({
      id: `db-${where.connectionId}`, providerId: where.connectionId.replace("provider-default-", ""),
      credentialEntryId: null, status: "disabled",
    }));
    await exchangeOAuthCode("state-1", "code-1");
    for (const [args] of mockPrisma.aiProviderConnection.update.mock.calls) expect(args.data).not.toHaveProperty("status");
    for (const [args] of mockPrisma.aiProviderConnection.updateMany.mock.calls) expect(args.where.status).toBe("unconfigured");
  });

  it("exchanges an additional account without copying credentials to the default or sibling", async () => {
    mockPrisma.oAuthPendingFlow.findUnique.mockResolvedValue({ id: "flow-b", providerId: "codex", connectionId: "account-b", codeVerifier: "verifier-b", createdAt: new Date() });
    mockPrisma.aiProviderConnection.findUnique.mockResolvedValue({ id: "connection-b", providerId: "codex", credentialEntryId: "credential-b", credentialEntry: { id: "credential-b" } });
    const result = await exchangeOAuthCode("state-b", "code-b");
    expect(result).toEqual({ providerId: "codex", connectionId: "account-b" });
    expect(mockPrisma.credentialEntry.upsert).toHaveBeenCalledTimes(1);
    expect(mockPrisma.credentialEntry.upsert).toHaveBeenCalledWith(expect.objectContaining({ where: { id: "credential-b" } }));
    expect(mockPrisma.aiProviderConnection.update).toHaveBeenCalledWith(expect.objectContaining({ where: { connectionId: "account-b" }, data: expect.objectContaining({ authMethod: "oauth", evidenceStatus: "unreviewed", accessibleModelIds: [] }) }));
    expect(mockPrisma.aiProviderConnection.updateMany).toHaveBeenCalledWith({ where: { connectionId: "account-b", status: { not: "disabled" } }, data: { status: "active" } });
    expect(mockPrisma.complianceEvidence.updateMany).toHaveBeenCalledWith(expect.objectContaining({ where: expect.objectContaining({ providerConnectionId: "connection-b" }) }));
    expect(mockAutoDiscoverAndProfile).not.toHaveBeenCalled();
    expect(mockRefreshDefaultOwners).not.toHaveBeenCalled();
  });

  it("consumes a callback state once when two requests race", async () => {
    mockPrisma.oAuthPendingFlow.deleteMany.mockResolvedValueOnce({ count: 1 }).mockResolvedValueOnce({ count: 0 });
    const outcomes = await Promise.all([exchangeOAuthCode("state-1", "code-1"), exchangeOAuthCode("state-1", "code-1")]);
    expect(outcomes.filter((outcome) => "error" in outcome)).toEqual([{ error: "invalid_state" }]);
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  it("keeps the stored refresh token when the token response carries none", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({ access_token: "access-token", expires_in: 3600 }),
      }),
    );

    await exchangeOAuthCode("state-1", "code-1");

    const calls = mockPrisma.credentialEntry.upsert.mock.calls.map(([args]) => args);
    expect(calls.map((c) => c.where.providerId).sort()).toEqual(["chatgpt", "codex"]);
    for (const call of calls) {
      expect(call.update).not.toHaveProperty("refreshToken");
      expect(call.update.cachedToken).toBe("enc:access-token");
      expect(call.create.refreshToken).toBeNull();
    }
  });

  it("stores a new refresh token on both OpenAI rows when one is issued", async () => {
    await exchangeOAuthCode("state-1", "code-1");

    const calls = mockPrisma.credentialEntry.upsert.mock.calls.map(([args]) => args);
    expect(calls).toHaveLength(2);
    for (const call of calls) {
      expect(call.update.refreshToken).toBe("enc:refresh-token");
    }
  });

  it("completes OAuth activation even when reconciliation fails", async () => {
    mockAutoDiscoverAndProfile.mockRejectedValue(new Error("discovery failed"));

    const result = await exchangeOAuthCode("state-1", "code-1");

    expect(result).toEqual({ providerId: "codex" });
    expect(mockPrisma.credentialEntry.upsert).toHaveBeenCalled();
    expect(mockAutoDiscoverAndProfile).toHaveBeenCalledWith("codex");
  });
});

describe("refreshOAuthToken", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockPrisma.modelProvider.findUnique.mockResolvedValue({
      providerId: "codex",
      tokenUrl: "https://auth.openai.com/oauth/token",
      oauthClientId: "client-codex",
    });
    mockPrisma.credentialEntry.updateMany.mockResolvedValue({ count: 2 });
    vi.stubGlobal("fetch", vi.fn());
  });

  // BI-46461599: the credential read "ok" for a week after it expired with no
  // way to refresh.
  it("marks an expired credential without a refresh token expired, with its sibling", async () => {
    mockPrisma.credentialEntry.findUnique.mockResolvedValue({
      providerId: "codex",
      refreshToken: null,
      tokenExpiresAt: new Date(Date.now() - 60_000),
      status: "ok",
    });

    const result = await refreshOAuthToken("codex");

    expect(result).toEqual({ error: "Re-authentication required" });
    expect(mockPrisma.credentialEntry.updateMany).toHaveBeenCalledWith({
      where: { providerId: { in: ["codex", "chatgpt"] } },
      data: { status: "expired" },
    });
    expect(fetch).not.toHaveBeenCalled();
  });

  it("marks only the row itself for a provider with no OpenAI sibling", async () => {
    mockPrisma.modelProvider.findUnique.mockResolvedValue({
      providerId: "other",
      tokenUrl: "https://example.test/oauth/token",
      oauthClientId: "client-other",
    });
    mockPrisma.credentialEntry.findUnique.mockResolvedValue({
      providerId: "other",
      refreshToken: null,
      tokenExpiresAt: new Date(Date.now() - 60_000),
      status: "ok",
    });

    await refreshOAuthToken("other");

    expect(mockPrisma.credentialEntry.updateMany).toHaveBeenCalledWith({
      where: { providerId: { in: ["other"] } },
      data: { status: "expired" },
    });
  });

  it("leaves a still-valid credential without a refresh token untouched", async () => {
    mockPrisma.credentialEntry.findUnique.mockResolvedValue({
      providerId: "codex",
      refreshToken: null,
      tokenExpiresAt: new Date(Date.now() + 60 * 60_000),
      status: "ok",
    });

    const result = await refreshOAuthToken("codex");

    expect(result).toEqual({ error: "Re-authentication required" });
    expect(mockPrisma.credentialEntry.updateMany).not.toHaveBeenCalled();
  });

  it("preserves account trust and model proofs during routine token refresh", async () => {
    mockPrisma.credentialEntry.findUnique.mockResolvedValue({ id: "default-credential", refreshToken: "enc:refresh", status: "ok" });
    vi.mocked(fetch).mockResolvedValue({ ok: true, json: async () => ({ access_token: "renewed", expires_in: 3600 }) } as Response);
    expect(await refreshOAuthToken("codex")).toEqual({ token: "renewed" });
    expect(mockPrisma.aiProviderConnection.update).not.toHaveBeenCalled();
    expect(mockPrisma.complianceEvidence.updateMany).not.toHaveBeenCalled();
  });

  it("expires only the selected additional account when it cannot refresh", async () => {
    mockPrisma.aiProviderConnection.findUnique.mockResolvedValue({ providerId: "codex", credentialEntry: { id: "credential-b", refreshToken: null, tokenExpiresAt: new Date(Date.now() - 60_000) } });
    await refreshOAuthToken("codex", "account-b");
    expect(mockPrisma.credentialEntry.updateMany).toHaveBeenCalledWith({ where: { id: "credential-b" }, data: { status: "expired" } });
    expect(mockPrisma.credentialEntry.findUnique).not.toHaveBeenCalled();
  });
});

describe("findPendingOAuthProviderId", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns the provider id for a known OAuth state", async () => {
    mockPrisma.oAuthPendingFlow.findUnique.mockResolvedValue({
      providerId: "codex",
    });

    await expect(findPendingOAuthProviderId("state-1")).resolves.toBe("codex");
  });

  it("returns null when state is missing", async () => {
    await expect(findPendingOAuthProviderId(null)).resolves.toBeNull();
    expect(mockPrisma.oAuthPendingFlow.findUnique).not.toHaveBeenCalled();
  });
});

describe("buildProviderOAuthErrorPath", () => {
  it("returns the provider page path when provider id is known", () => {
    expect(buildProviderOAuthErrorPath("codex", "token_exchange_failed")).toBe(
      "/platform/ai/providers/codex?oauth=error&reason=token_exchange_failed",
    );
  });

  it("falls back to the AI overview page when provider id is unknown", () => {
    expect(buildProviderOAuthErrorPath(null, "missing_params")).toBe(
      "/platform/ai?oauth=error&reason=missing_params",
    );
  });
});
