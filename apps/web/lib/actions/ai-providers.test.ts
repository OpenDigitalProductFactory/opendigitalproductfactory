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
} = vi.hoisted(() => ({
  mockPrisma: {
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
    },
    platformConfig: {
      findUnique: vi.fn(),
      create: vi.fn(),
      update: vi.fn(),
    },
    aiProviderConnection: {
      findUnique: vi.fn(),
      update: vi.fn(),
    },
  },
  mockAutoDiscoverAndProfile: vi.fn(),
  mockGetDecryptedCredential: vi.fn(),
  mockGetProviderBearerToken: vi.fn(),
  mockCan: vi.fn(),
  mockAuth: vi.fn(),
  mockActivateProvider: vi.fn(),
  mockSeedAiProviderFinanceBridge: vi.fn(),
  mockRecordProviderTrustEvidence: vi.fn().mockResolvedValue({ evidenceId: "evidence-1" }),
  mockSupersedeProviderTrustEvidenceClaim: vi.fn().mockResolvedValue(undefined),
}));

vi.mock("@dpf/db", () => ({
  prisma: mockPrisma,
  ensureDefaultProviderConnection: vi.fn(),
  refreshDefaultProviderConnectionOwners: vi.fn(),
}));

vi.mock("@/lib/auth", () => ({
  auth: mockAuth,
}));

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
} from "./ai-providers";
import { updateProviderConnectionPosture } from "./provider-connection-posture";

describe("updateProviderConnectionPosture", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockAuth.mockResolvedValue({ user: { id: "user-1", platformRole: "HR-000", isSuperuser: true } });
    mockCan.mockReturnValue(true);
  });

  it("records an operator attestation without promoting it to contract proof", async () => {
    mockPrisma.aiProviderConnection.findUnique.mockResolvedValue({
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
        text: async () => "",
      }),
    );
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

  it("uses known-model seeding for Codex instead of raw live discovery", async () => {
    mockAutoDiscoverAndProfile.mockResolvedValue({ discovered: 2, profiled: 2 });

    const result = await discoverModels("codex");

    expect(result).toEqual(expect.objectContaining({ discovered: 2, newCount: 2, error: undefined }));
    expect(mockAutoDiscoverAndProfile).toHaveBeenCalledWith("codex");
  });

  it("uses known-model seeding for xAI/Grok so OAuth-only Build Studio sync does not hit /v1/models", async () => {
    mockAutoDiscoverAndProfile.mockResolvedValue({ discovered: 2, profiled: 2 });

    const result = await discoverModels("xai");

    expect(result).toEqual(expect.objectContaining({ discovered: 2, newCount: 2, error: undefined }));
    expect(mockAutoDiscoverAndProfile).toHaveBeenCalledWith("xai");
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
