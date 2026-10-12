import { beforeEach, describe, expect, it, vi } from "vitest";

const {
  mockPrisma,
  mockAutoDiscoverAndProfile,
  mockGetDecryptedCredential,
  mockGetProviderBearerToken,
  mockCan,
  mockAuth,
  mockActivateProvider,
  mockSeedAiProviderFinanceBridge,
  mockRecordProviderTrustEvidence,
  mockSupersedeProviderTrustEvidenceClaim,
  mockClearCapacity,
} = vi.hoisted(() => ({
  mockPrisma: {
    modelProfile: { findFirst: vi.fn(), findMany: vi.fn() },
    modelProvider: {
      findUnique: vi.fn(),
      update: vi.fn(),
    },
    scheduledJob: {
      upsert: vi.fn(),
      update: vi.fn(),
    },
    credentialEntry: {
      findUnique: vi.fn(),
      upsert: vi.fn(),
      update: vi.fn(),
    },
    platformConfig: {
      findUnique: vi.fn(),
      create: vi.fn(),
      update: vi.fn(),
    },
    aiProviderConnection: {
      findUnique: vi.fn(),
      update: vi.fn(),
      updateMany: vi.fn(),
    },
  },
  mockAutoDiscoverAndProfile: vi.fn(),
  mockClearCapacity: vi.fn(),
  mockGetDecryptedCredential: vi.fn(),
  mockGetProviderBearerToken: vi.fn(),
  mockCan: vi.fn(),
  mockAuth: vi.fn(),
  mockActivateProvider: vi.fn(),
  mockSeedAiProviderFinanceBridge: vi.fn(),
  mockRecordProviderTrustEvidence: vi.fn().mockResolvedValue({ evidenceId: "evidence-1" }),
  mockSupersedeProviderTrustEvidenceClaim: vi.fn().mockResolvedValue(undefined),
}));
const mockResumeProvider = vi.hoisted(() => vi.fn());
vi.mock("@/lib/inference/provider-operator-pause", () => ({ resumeOperatorProvider: mockResumeProvider }));

vi.mock("@dpf/db", () => ({
  prisma: mockPrisma,
  ensureDefaultProviderConnection: vi.fn(),
  refreshDefaultProviderConnectionOwners: vi.fn(),
  setProviderStatusWithDefaultConnection: vi.fn(),
}));

vi.mock("@/lib/auth", () => ({
  auth: mockAuth,
}));
vi.mock("@/lib/routing/provider-capacity/store", () => ({ clearProviderCapacityStatus: mockClearCapacity }));

vi.mock("@/lib/permissions", () => ({
  can: mockCan,
}));

vi.mock("@/lib/govern/activate-provider", () => ({
  activateProvider: mockActivateProvider,
}));

vi.mock("@/lib/finance/ai-provider-finance", () => ({
  seedAiProviderFinanceBridge: mockSeedAiProviderFinanceBridge,
}));

vi.mock("@/lib/routing/provider-suitability/evidence", () => ({
  recordProviderTrustEvidence: mockRecordProviderTrustEvidence,
  supersedeProviderTrustEvidenceClaim: mockSupersedeProviderTrustEvidenceClaim,
}));

vi.mock("@/lib/ai-provider-internals", () => ({
  autoDiscoverAndProfile: mockAutoDiscoverAndProfile,
  discoverModelsInternal: vi.fn(),
  profileModelsInternal: vi.fn(),
  getDecryptedCredential: mockGetDecryptedCredential,
  getProviderExtraHeaders: vi.fn(() => ({})),
  getProviderBearerToken: mockGetProviderBearerToken,
  isAnthropicProvider: vi.fn(() => false),
  ANTHROPIC_OAUTH_BETA_HEADERS: "oauth-2025-04-20",
  backfillModelCards: vi.fn(),
  seedAllRecipes: vi.fn(),
}));

import {
  configureProvider,
  discoverModels,
  runProviderCatalogReconciliationIfDue,
  testProviderAuth,
  toggleProviderStatus,
} from "./ai-providers";
import { setProviderStatusWithDefaultConnection } from "@dpf/db";
import { updateProviderConnectionPosture } from "./provider-connection-posture";

describe("operator provider toggle", () => {
  it("disables the connection together with the provider", async () => {
    mockAuth.mockResolvedValue({ user: { id: "user-1", platformRole: "HR-000", isSuperuser: true } });
    mockCan.mockReturnValue(true);
    mockPrisma.modelProvider.findUnique.mockResolvedValue({ status: "active" });
    await expect(toggleProviderStatus("local")).resolves.toEqual({ status: "inactive", warning: null });
    expect(setProviderStatusWithDefaultConnection).toHaveBeenCalledWith(mockPrisma, { providerId: "local", status: "inactive" });
  });
  it.each(["inactive", "disabled"])("enables an account whose connection is %s even when the provider is active", async status => {
    mockAuth.mockResolvedValue({ user: { id: "user-1", platformRole: "HR-000", isSuperuser: true } });
    mockCan.mockReturnValue(true);
    mockPrisma.modelProvider.findUnique.mockResolvedValue({ status: "active", endpointType: "responses" });
    mockPrisma.aiProviderConnection.findUnique.mockResolvedValue({ status });
    mockPrisma.modelProfile.findMany.mockResolvedValue([{ capabilities: { toolUse: true } }]);
    await expect(toggleProviderStatus("chatgpt")).resolves.toEqual({ status: "active", warning: null });
  });
  it("resumes a cloud pause without overwriting its automatic disabled status", async () => {
    mockAuth.mockResolvedValue({ user: { id: "user-1", platformRole: "HR-000", isSuperuser: true } });
    mockCan.mockReturnValue(true);
    mockPrisma.modelProvider.findUnique.mockResolvedValue({ status: "disabled", endpointType: "responses" });
    mockPrisma.aiProviderConnection.findUnique.mockResolvedValue({ status: "paused" });
    mockResumeProvider.mockResolvedValue({ outcome: "resumed", status: "disabled", connectionStatus: "active" });
    vi.mocked(setProviderStatusWithDefaultConnection).mockClear();
    await expect(toggleProviderStatus("chatgpt")).resolves.toMatchObject({ status: "disabled" });
    expect(mockResumeProvider).toHaveBeenCalledWith({ providerId: "chatgpt", actorId: "user-1" });
    expect(setProviderStatusWithDefaultConnection).not.toHaveBeenCalled();
  });
});

describe("updateProviderConnectionPosture", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockAuth.mockResolvedValue({ user: { id: "user-1", platformRole: "HR-000", isSuperuser: true } });
    mockCan.mockReturnValue(true);
  });

  it("attests the selected account without activating or changing the default account", async () => {
    mockPrisma.aiProviderConnection.findUnique.mockResolvedValue({ id: "connection-b", providerId: "anthropic", entitlements: {}, evidenceStatus: "unreviewed" });
    mockPrisma.modelProvider.findUnique.mockResolvedValue({ status: "active" });
    expect(await updateProviderConnectionPosture({ providerId: "anthropic", connectionId: "account-b", accountClass: "business-team", noTraining: true })).toEqual({});
    expect(mockPrisma.aiProviderConnection.update).toHaveBeenCalledWith(expect.objectContaining({ where: { connectionId: "account-b" } }));
    expect(mockRecordProviderTrustEvidence).toHaveBeenCalledWith(expect.objectContaining({ providerConnectionDbId: "connection-b" }));
    expect(mockActivateProvider).not.toHaveBeenCalled();
  });

  it("rejects evidence changes to an account belonging to another provider", async () => {
    mockPrisma.aiProviderConnection.findUnique.mockResolvedValue({ id: "wrong", providerId: "openai" });
    expect(await updateProviderConnectionPosture({ providerId: "anthropic", connectionId: "wrong", accountClass: "enterprise", noTraining: true })).toHaveProperty("error");
    expect(mockPrisma.aiProviderConnection.update).not.toHaveBeenCalled();
  });

  it("records an operator attestation without promoting it to contract proof", async () => {
    mockPrisma.aiProviderConnection.findUnique.mockResolvedValue({
      providerId: "anthropic",
      id: "connection-db-1",
      entitlements: { adminAuditControls: true },
      evidenceStatus: "unreviewed",
    });
    mockPrisma.aiProviderConnection.update.mockResolvedValue({});
    mockPrisma.modelProvider.findUnique.mockResolvedValue({ status: "active" });

    await updateProviderConnectionPosture({
      providerId: "anthropic",
      accountClass: "business-team",
      noTraining: true,
      enabledRegions: [" EU ", "eu", "UK"],
    });

    expect(mockPrisma.aiProviderConnection.update).toHaveBeenCalledWith({
      where: { connectionId: "provider-default-anthropic" },
      data: expect.objectContaining({
        accountClass: "business-team",
        evidenceStatus: "operator-attested",
        entitlements: { adminAuditControls: true, noTraining: true, enabledRegions: ["eu", "uk"] },
      }),
    });
    expect(mockActivateProvider).toHaveBeenCalledWith("anthropic", {
      trigger: "test_auth",
      skipDiscovery: true,
    });
    expect(mockRecordProviderTrustEvidence).toHaveBeenCalledWith(expect.objectContaining({
      providerConnectionDbId: "connection-db-1",
      claimKey: "no-training",
      assertedValue: true,
      evidenceType: "provider-operator-attestation",
    }));
    expect(mockRecordProviderTrustEvidence).toHaveBeenCalledWith(expect.objectContaining({
      providerConnectionDbId: "connection-db-1",
      claimKey: "enabled-regions",
      assertedValue: ["eu", "uk"],
    }));
  });

  it("supersedes prior operator evidence when the declaration returns to unknown", async () => {
    mockPrisma.aiProviderConnection.findUnique.mockResolvedValue({
      providerId: "anthropic",
      id: "connection-db-1",
      entitlements: {},
      evidenceStatus: "operator-attested",
    });
    mockPrisma.aiProviderConnection.update.mockResolvedValue({});
    mockPrisma.modelProvider.findUnique.mockResolvedValue({ status: "inactive" });

    await updateProviderConnectionPosture({
      providerId: "anthropic",
      accountClass: "unknown",
      noTraining: null,
      enabledRegions: [],
    });

    expect(mockSupersedeProviderTrustEvidenceClaim).toHaveBeenCalledWith({
      providerConnectionDbId: "connection-db-1",
      claimKey: "no-training",
    });
    expect(mockSupersedeProviderTrustEvidenceClaim).toHaveBeenCalledWith({
      providerConnectionDbId: "connection-db-1",
      claimKey: "enabled-regions",
    });
  });

  it("preserves region entitlement and evidence when the current setup has no region requirement", async () => {
    mockPrisma.aiProviderConnection.findUnique.mockResolvedValue({
      providerId: "zai",
      id: "connection-db-1",
      entitlements: { enabledRegions: ["us"], regionalProcessing: true },
      evidenceStatus: "operator-attested",
    });
    mockPrisma.aiProviderConnection.update.mockResolvedValue({});
    mockPrisma.modelProvider.findUnique.mockResolvedValue({ status: "inactive" });

    await updateProviderConnectionPosture({
      providerId: "zai",
      accountClass: "enterprise",
      noTraining: true,
    });

    expect(mockPrisma.aiProviderConnection.update).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({
        entitlements: expect.objectContaining({ enabledRegions: ["us"], regionalProcessing: true }),
      }),
    }));
    expect(mockRecordProviderTrustEvidence).not.toHaveBeenCalledWith(expect.objectContaining({ claimKey: "enabled-regions" }));
    expect(mockSupersedeProviderTrustEvidenceClaim).not.toHaveBeenCalledWith(expect.objectContaining({ claimKey: "enabled-regions" }));
  });

  it("records a normalized direct-provider region guarantee on the exact connection", async () => {
    mockPrisma.aiProviderConnection.findUnique.mockResolvedValue({
      providerId: "zai",
      id: "connection-db-1",
      entitlements: {},
      evidenceStatus: "unreviewed",
    });
    mockPrisma.aiProviderConnection.update.mockResolvedValue({});
    mockPrisma.modelProvider.findUnique.mockResolvedValue({ status: "inactive" });

    await updateProviderConnectionPosture({
      providerId: "zai",
      accountClass: "enterprise",
      noTraining: true,
      enabledRegions: [" US ", "us"],
      regionalProcessing: true,
    });

    expect(mockPrisma.aiProviderConnection.update).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({
        entitlements: expect.objectContaining({ enabledRegions: ["us"], regionalProcessing: true }),
      }),
    }));
    expect(mockRecordProviderTrustEvidence).toHaveBeenCalledWith(expect.objectContaining({
      providerConnectionDbId: "connection-db-1",
      claimKey: "regional-processing",
      assertedValue: true,
    }));
    expect(mockRecordProviderTrustEvidence).toHaveBeenCalledWith(expect.objectContaining({
      providerConnectionDbId: "connection-db-1",
      claimKey: "enabled-regions",
      assertedValue: ["us"],
    }));
  });

  it("records OpenRouter controls on the exact connection without creating enterprise proof", async () => {
    mockPrisma.aiProviderConnection.findUnique.mockResolvedValue({
      providerId: "openrouter",
      entitlements: {},
      evidenceStatus: "unreviewed",
    });
    mockPrisma.aiProviderConnection.update.mockResolvedValue({});
    mockPrisma.modelProvider.findUnique.mockResolvedValue({ status: "active" });

    await updateProviderConnectionPosture({
      providerId: "openrouter",
      accountClass: "regular",
      noTraining: true,
      enabledRegions: ["eu"],
      zeroRetention: true,
      regionalProcessing: true,
      approvedUnderlyingProviderSlugs: [" Anthropic ", "google-vertex/europe-west4", "bad slug!"],
    });

    expect(mockPrisma.aiProviderConnection.update).toHaveBeenCalledWith({
      where: { connectionId: "provider-default-openrouter" },
      data: expect.objectContaining({
        accountClass: "regular",
        evidenceStatus: "operator-attested",
        entitlements: {
          noTraining: true,
          enabledRegions: ["eu"],
          zeroRetention: true,
          regionalProcessing: true,
          approvedUnderlyingProviderSlugs: ["anthropic", "google-vertex/europe-west4"],
        },
      }),
    });
  });
});

describe("testProviderAuth", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockPrisma.modelProfile.findFirst.mockResolvedValue({ modelId: "discovered-current-model" });

    mockAuth.mockResolvedValue({
      user: {
        id: "user-1",
        platformRole: "HR-000",
        isSuperuser: true,
      },
    });
    mockCan.mockReturnValue(true);
    mockPrisma.modelProvider.update.mockResolvedValue({});
    mockPrisma.credentialEntry.upsert.mockResolvedValue({});
    mockPrisma.platformConfig.findUnique.mockResolvedValue(null);
    mockPrisma.platformConfig.create.mockResolvedValue({});
    mockPrisma.platformConfig.update.mockResolvedValue({});
    mockPrisma.scheduledJob.upsert.mockResolvedValue({
      jobId: "provider-catalog-reconciliation",
      schedule: "weekly",
      lastRunAt: null,
      nextRunAt: new Date("2026-04-04T00:00:00.000Z"),
    });
    mockPrisma.scheduledJob.update.mockResolvedValue({});
    mockAutoDiscoverAndProfile.mockResolvedValue({ discovered: 1, profiled: 1 });
    mockActivateProvider.mockResolvedValue({});
    mockSeedAiProviderFinanceBridge.mockResolvedValue({});
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        statusText: "OK",
        text: async () => 'data: {"type":"response.completed","response":{"status":"completed"}}\n',
      }),
    );
  });

  it("authenticates only the selected account and preserves a concurrent disable", async () => {
    mockPrisma.modelProvider.findUnique.mockResolvedValue({ providerId: "openai", baseUrl: "https://api.openai.com/v1", authMethod: "api_key", authHeader: "Authorization", families: [], enabledFamilies: [], supportedAuthMethods: ["api_key"] });
    mockPrisma.aiProviderConnection.findUnique.mockResolvedValue({ providerId: "openai", connectionId: "account-b", credentialEntryId: "credential-b", authMethod: "api-key", status: "active", updatedAt: new Date("2026-10-01") });
    mockPrisma.aiProviderConnection.updateMany.mockResolvedValue({ count: 1 });
    mockGetDecryptedCredential.mockResolvedValue({ secretRef: "key-b" });
    Object.assign(mockPrisma, { $transaction: async (fn: (tx: typeof mockPrisma) => Promise<unknown>) => fn(mockPrisma) });
    expect(await testProviderAuth("openai", false, "account-b")).toMatchObject({ ok: true });
    expect(fetch).toHaveBeenCalledWith(expect.any(String), expect.objectContaining({ headers: { Authorization: "Bearer key-b" } }));
    expect(mockPrisma.credentialEntry.update).toHaveBeenCalledWith({ where: { id: "credential-b" }, data: { status: "ok" } });
    expect(mockPrisma.aiProviderConnection.updateMany).toHaveBeenCalledWith({ where: { connectionId: "account-b", credentialEntryId: "credential-b", updatedAt: new Date("2026-10-01"), status: { not: "disabled" } }, data: { status: "active" } });
    expect(mockActivateProvider).not.toHaveBeenCalled();
    mockPrisma.aiProviderConnection.updateMany.mockResolvedValue({ count: 0 });
    mockPrisma.credentialEntry.update.mockClear();
    expect(await testProviderAuth("openai", false, "account-b")).toMatchObject({ ok: false, message: expect.stringContaining("Account changed") });
    expect(mockPrisma.credentialEntry.update).not.toHaveBeenCalled();
  });

  it("triggers reconciliation for OAuth subscription-style providers", async () => {
    mockPrisma.modelProvider.findUnique.mockImplementation(({ where }: { where: { providerId: string } }) => {
      if (where.providerId === "codex") {
        return Promise.resolve({
          providerId: "codex",
          name: "Codex",
          baseUrl: "https://api.openai.com/v1",
          endpoint: null,
          authMethod: "oauth2_authorization_code",
          authHeader: "Authorization",
          category: "agent",
          families: [],
          enabledFamilies: [],
          supportedAuthMethods: ["oauth2_authorization_code"],
        });
      }
      if (where.providerId === "chatgpt") {
        return Promise.resolve({
          providerId: "chatgpt",
          baseUrl: "https://chatgpt.com/backend-api",
          endpoint: null,
        });
      }
      return Promise.resolve(null);
    });
    mockGetProviderBearerToken.mockResolvedValue({ token: "token-1" });
    mockPrisma.credentialEntry.findUnique.mockResolvedValue({
      providerId: "codex",
      status: "ok",
      cachedToken: "enc:token-1",
    });

    const result = await testProviderAuth("codex");

    expect(result).toEqual({
      ok: true,
      message: "Connected via OAuth — Responses API verified",
    });
    expect(fetch).toHaveBeenCalledWith(
      "https://chatgpt.com/backend-api/codex/responses",
      expect.objectContaining({ method: "POST" }),
    );
    expect(mockActivateProvider).toHaveBeenCalledWith(
      "codex",
      expect.objectContaining({
        trigger: "test_auth",
        authMethod: "oauth2_authorization_code",
        activateLinked: true,
      }),
    );
  });

  it("verifies the ChatGPT subscription backend through the responses path", async () => {
    mockPrisma.modelProvider.findUnique.mockResolvedValue({
      providerId: "chatgpt",
      name: "ChatGPT",
      baseUrl: "https://chatgpt.com/backend-api",
      endpoint: null,
      authMethod: "oauth2_authorization_code",
      authHeader: "Authorization",
      category: "direct",
      families: [],
      enabledFamilies: [],
      supportedAuthMethods: ["oauth2_authorization_code"],
    });
    mockGetProviderBearerToken.mockResolvedValue({ token: "token-1" });
    mockPrisma.credentialEntry.findUnique.mockResolvedValue({
      providerId: "chatgpt",
      status: "ok",
      cachedToken: "enc:token-1",
    });

    const result = await testProviderAuth("chatgpt");

    expect(result).toEqual({
      ok: true,
      message: "Connected via OAuth — Responses API verified",
    });
    expect(fetch).toHaveBeenCalledWith(
      "https://chatgpt.com/backend-api/codex/responses",
      expect.objectContaining({ method: "POST" }),
    );
    expect(mockActivateProvider).toHaveBeenCalledWith(
      "chatgpt",
      expect.objectContaining({
        trigger: "test_auth",
        authMethod: "oauth2_authorization_code",
        activateLinked: true,
      }),
    );
    const request = vi.mocked(fetch).mock.calls[0]![1]!;
    expect(JSON.parse(request.body as string)).toMatchObject({
      model: "discovered-current-model", stream: true, instructions: "Reply with OK only.", store: false,
    });
    expect(mockClearCapacity).toHaveBeenCalledWith({ providerId: "chatgpt", source: "oauth" });
  });

  it.each([400, 429, 500])("does not clear capacity or activate on HTTP %s", async (status) => {
    mockPrisma.modelProvider.findUnique.mockResolvedValue({
      providerId: "chatgpt", baseUrl: "https://chatgpt.com/backend-api", authMethod: "oauth2_authorization_code",
      families: [], enabledFamilies: [], supportedAuthMethods: [],
    });
    mockGetProviderBearerToken.mockResolvedValue({ token: "token-1" });
    mockPrisma.credentialEntry.findUnique.mockResolvedValue({ status: "ok", cachedToken: "encrypted" });
    vi.mocked(fetch).mockResolvedValue(new Response("rejected", { status }));
    expect(await testProviderAuth("chatgpt")).toMatchObject({ ok: false, message: expect.stringContaining("/codex/responses") });
    expect(mockClearCapacity).not.toHaveBeenCalled();
    expect(mockActivateProvider).not.toHaveBeenCalled();
  });

  it.each(["network", "incomplete"])("preserves capacity after %s failure and reports the attempted endpoint", async (failure) => {
    mockPrisma.modelProvider.findUnique.mockResolvedValue({
      providerId: "chatgpt", baseUrl: "https://chatgpt.com/backend-api", authMethod: "oauth2_authorization_code",
      families: [], enabledFamilies: [], supportedAuthMethods: [],
    });
    mockGetProviderBearerToken.mockResolvedValue({ token: "token-1" });
    mockPrisma.credentialEntry.findUnique.mockResolvedValue({ status: "ok", cachedToken: "encrypted" });
    if (failure === "network") vi.mocked(fetch).mockRejectedValue(new Error("fetch failed"));
    else vi.mocked(fetch).mockResolvedValue(new Response('data: {"type":"response.incomplete"}\n'));
    expect(await testProviderAuth("chatgpt")).toMatchObject({ ok: false, message: expect.stringContaining("/codex/responses") });
    expect(mockClearCapacity).not.toHaveBeenCalled();
    expect(mockActivateProvider).not.toHaveBeenCalled();
  });

  it("returns a reconnect hint when the OAuth token is missing Responses scope", async () => {
    mockPrisma.modelProvider.findUnique.mockImplementation(({ where }: { where: { providerId: string } }) => {
      if (where.providerId === "codex") {
        return Promise.resolve({
          providerId: "codex",
          name: "Codex",
          baseUrl: "https://api.openai.com/v1",
          endpoint: null,
          authMethod: "oauth2_authorization_code",
          authHeader: "Authorization",
          category: "agent",
          families: [],
          enabledFamilies: [],
          supportedAuthMethods: ["oauth2_authorization_code"],
        });
      }
      if (where.providerId === "chatgpt") {
        return Promise.resolve({
          providerId: "chatgpt",
          baseUrl: "https://chatgpt.com/backend-api",
          endpoint: null,
        });
      }
      return Promise.resolve(null);
    });
    mockGetProviderBearerToken.mockResolvedValue({ token: "token-1" });
    mockPrisma.credentialEntry.findUnique.mockResolvedValue({
      providerId: "codex",
      status: "ok",
      cachedToken: "enc:token-1",
    });
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: false,
        status: 401,
        text: async () =>
          JSON.stringify({
            error: {
              message: "Missing scopes: api.responses.write",
            },
          }),
      }),
    );

    const result = await testProviderAuth("codex");

    expect(result).toEqual({
      ok: false,
      message:
        "OAuth token is missing Responses API scope (api.responses.write) — disconnect and sign in again",
    });
    expect(mockActivateProvider).not.toHaveBeenCalled();
  });

  it("triggers reconciliation for direct cloud providers after a successful auth test", async () => {
    mockPrisma.modelProvider.findUnique.mockResolvedValue({
      providerId: "openai",
      name: "OpenAI",
      baseUrl: "https://api.openai.com/v1",
      endpoint: null,
      authMethod: "api_key",
      authHeader: "Authorization",
      category: "llm",
      families: [],
      enabledFamilies: [],
      supportedAuthMethods: ["api_key"],
    });
    mockGetDecryptedCredential.mockResolvedValue({ secretRef: "sk-test" });

    const result = await testProviderAuth("openai");

    expect(result).toEqual({
      ok: true,
      message: "Connected — HTTP 200",
    });
    expect(mockActivateProvider).toHaveBeenCalledWith(
      "openai",
      expect.objectContaining({ trigger: "test_auth" }),
    );
  });

  it("does not trigger reconciliation when auth validation fails", async () => {
    mockPrisma.modelProvider.findUnique.mockResolvedValue({
      providerId: "openai",
      name: "OpenAI",
      baseUrl: "https://api.openai.com/v1",
      endpoint: null,
      authMethod: "api_key",
      authHeader: "Authorization",
      category: "llm",
      families: [],
      enabledFamilies: [],
      supportedAuthMethods: ["api_key"],
    });
    mockGetDecryptedCredential.mockResolvedValue(null);

    const result = await testProviderAuth("openai");

    expect(result).toEqual({
      ok: false,
      message: "No API key configured",
    });
    expect(mockActivateProvider).not.toHaveBeenCalled();
  });

  it("reports the OAuth connection for a Grok provider connected via device-code (no API key needed)", async () => {
    mockPrisma.modelProvider.findUnique.mockResolvedValue({
      providerId: "xai",
      name: "xAI (Grok)",
      baseUrl: "https://api.x.ai/v1",
      endpoint: null,
      authMethod: "api_key",
      authHeader: "Authorization",
      category: "direct",
      cliEngine: "grok",
      families: [],
      enabledFamilies: [],
      supportedAuthMethods: ["api_key", "oauth2_device"],
    });
    // OAuth dispatch credential = the ~/.grok/auth.json blob stored in cachedToken; no API key.
    mockGetDecryptedCredential.mockResolvedValue({
      cachedToken: '{"access_token":"xai-oauth","refresh_token":"r"}',
      secretRef: null,
    });

    const result = await testProviderAuth("xai");

    expect(result.ok).toBe(true);
    expect(result.message).toMatch(/OAuth/i);
    expect(result.message).not.toMatch(/No API key/i);
  });
});

describe("discoverModels", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockAuth.mockResolvedValue({
      user: {
        id: "user-1",
        platformRole: "HR-000",
        isSuperuser: true,
      },
    });
    mockCan.mockReturnValue(true);
  });

  it("returns the actual new count from a serving-catalog refresh", async () => {
    mockAutoDiscoverAndProfile.mockResolvedValue({ discovered: 2, newCount: 0, profiled: 2 });

    const result = await discoverModels("codex");

    expect(result).toEqual(expect.objectContaining({ discovered: 2, newCount: 0, profiled: 2 }));
    expect(mockAutoDiscoverAndProfile).toHaveBeenCalledWith("codex", false);
  });

  it("does not count a bootstrap fallback as a successful refresh", async () => {
    mockAutoDiscoverAndProfile.mockResolvedValue({ discovered: 0, profiled: 0, error: "HTTP 503" });

    const result = await discoverModels("xai");

    expect(result).toEqual(expect.objectContaining({ discovered: 0, newCount: 0, error: "HTTP 503" }));
    expect(mockAutoDiscoverAndProfile).toHaveBeenCalledWith("xai", false);
  });
});

describe("configureProvider", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockAuth.mockResolvedValue({
      user: {
        id: "user-1",
        platformRole: "HR-000",
        isSuperuser: true,
      },
    });
    mockCan.mockReturnValue(true);
    mockPrisma.modelProvider.update.mockResolvedValue({});
    mockPrisma.modelProvider.findUnique.mockResolvedValue({
      providerId: "openai",
      cliEngine: null,
    });
    mockActivateProvider.mockResolvedValue({});
    mockSeedAiProviderFinanceBridge.mockResolvedValue({});
  });

  it("seeds finance ownership after successful provider configuration", async () => {
    const result = await configureProvider({
      providerId: "openai",
      enabledFamilies: ["chat"],
      endpoint: "https://api.openai.com/v1",
    });

    expect(result).toEqual({});
    expect(mockActivateProvider).toHaveBeenCalledWith(
      "openai",
      expect.objectContaining({ trigger: "api_key_configure" }),
    );
    expect(mockSeedAiProviderFinanceBridge).toHaveBeenCalledWith(
      expect.objectContaining({
        providerId: "openai",
      }),
    );
  });

  it("activates the paired OpenAI provider when configuring ChatGPT OAuth", async () => {
    mockPrisma.modelProvider.findUnique.mockImplementation(({ select }: { select?: Record<string, boolean> }) => {
      if (select?.cliEngine) {
        return Promise.resolve({ providerId: "chatgpt", cliEngine: "codex" });
      }
      return Promise.resolve({
        providerId: "chatgpt",
        name: "ChatGPT",
        consoleUrl: "https://chatgpt.com",
        docsUrl: "https://platform.openai.com/docs",
        inputPricePerMToken: 0,
        outputPricePerMToken: 0,
      });
    });

    const result = await configureProvider({
      providerId: "chatgpt",
      enabledFamilies: ["gpt-5.4"],
      authMethod: "oauth2_authorization_code",
    });

    expect(result).toEqual({});
    expect(mockActivateProvider).toHaveBeenCalledWith(
      "chatgpt",
      expect.objectContaining({
        trigger: "api_key_configure",
        authMethod: "oauth2_authorization_code",
        activateLinked: true,
      }),
    );
  });

  it("activates the hidden Z.ai coding provider and configures OpenCode from the main Z.ai key", async () => {
    mockPrisma.modelProvider.findUnique.mockImplementation(({ where, select }: { where?: { providerId?: string }; select?: Record<string, boolean> }) => {
      if (select?.cliEngine) {
        return Promise.resolve({ providerId: where?.providerId, cliEngine: where?.providerId === "zai-coding" ? "opencode" : null });
      }
      return Promise.resolve({
        providerId: where?.providerId ?? "zai",
        name: where?.providerId === "zai-coding" ? "Z.ai GLM Coding" : "Z.ai",
        consoleUrl: "https://chat.z.ai",
        docsUrl: "https://docs.z.ai",
        inputPricePerMToken: 1.4,
        outputPricePerMToken: 4.4,
      });
    });
    mockPrisma.platformConfig.findUnique.mockResolvedValue(null);

    const result = await configureProvider({
      providerId: "zai",
      enabledFamilies: ["glm-5", "glm-coding"],
      authMethod: "api_key",
      secretRef: "zai-main-key",
    });

    expect(result).toEqual({});
    expect(mockActivateProvider).toHaveBeenCalledWith(
      "zai",
      expect.objectContaining({
        trigger: "api_key_configure",
        authMethod: "api_key",
        activateLinked: true,
      }),
    );
    expect(mockPrisma.platformConfig.create).toHaveBeenCalledWith({
      data: {
        key: "build-studio-dispatch",
        value: expect.objectContaining({
          provider: "opencode",
          opencodeProviderId: "zai-coding",
        }),
      },
    });
  });
});

describe("runProviderCatalogReconciliationIfDue", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockAutoDiscoverAndProfile.mockResolvedValue({ discovered: 2, profiled: 2 });
    mockPrisma.scheduledJob.upsert.mockResolvedValue({
      jobId: "provider-catalog-reconciliation",
      schedule: "weekly",
      lastRunAt: null,
      nextRunAt: new Date("2026-04-04T00:00:00.000Z"),
    });
    mockPrisma.scheduledJob.update.mockResolvedValue({});
  });

  it("upserts and runs the provider catalog reconciliation job when due", async () => {
    await runProviderCatalogReconciliationIfDue();

    expect(mockPrisma.scheduledJob.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { jobId: "provider-catalog-reconciliation" },
      }),
    );
    expect(mockPrisma.scheduledJob.update).toHaveBeenCalled();
    expect(mockAutoDiscoverAndProfile).toHaveBeenCalledWith("codex");
  });
});
