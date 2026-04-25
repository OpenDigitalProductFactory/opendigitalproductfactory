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
  },
  mockAutoDiscoverAndProfile: vi.fn(),
  mockGetDecryptedCredential: vi.fn(),
  mockGetProviderBearerToken: vi.fn(),
  mockCan: vi.fn(),
  mockAuth: vi.fn(),
  mockActivateProvider: vi.fn(),
  mockSeedAiProviderFinanceBridge: vi.fn(),
}));

vi.mock("@dpf/db", () => ({
  prisma: mockPrisma,
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
      expect.objectContaining({ trigger: "test_auth" }),
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
      expect.objectContaining({ trigger: "test_auth" }),
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
