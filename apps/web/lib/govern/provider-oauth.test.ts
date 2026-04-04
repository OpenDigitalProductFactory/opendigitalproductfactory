import { beforeEach, describe, expect, it, vi } from "vitest";

const { mockPrisma, mockAutoDiscoverAndProfile } = vi.hoisted(() => ({
  mockPrisma: {
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
    },
    mcpServer: {
      findMany: vi.fn(),
      update: vi.fn(),
    },
  },
  mockAutoDiscoverAndProfile: vi.fn(),
}));

vi.mock("@dpf/db", () => ({
  prisma: mockPrisma,
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

import { createOAuthFlow, exchangeOAuthCode } from "./provider-oauth";

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

  it("requests the Responses API scope for Codex OAuth flows", async () => {
    const result = await createOAuthFlow("codex");

    expect(result).toHaveProperty("authorizeUrl");
    const url = new URL((result as { authorizeUrl: string }).authorizeUrl);
    expect(url.searchParams.get("scope")).toBe("api.responses.write");
  });

  it("merges required Responses scope with configured OAuth scopes", async () => {
    mockPrisma.credentialEntry.findUnique.mockResolvedValue({
      providerId: "chatgpt",
      scope: "openid profile",
    });

    const result = await createOAuthFlow("chatgpt");

    expect(result).toHaveProperty("authorizeUrl");
    const url = new URL((result as { authorizeUrl: string }).authorizeUrl);
    expect(url.searchParams.get("scope")).toBe("openid profile api.responses.write");
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
    mockPrisma.modelProvider.update.mockResolvedValue({});
    mockPrisma.modelProvider.updateMany.mockResolvedValue({ count: 1 });
    mockPrisma.credentialEntry.upsert.mockResolvedValue({});
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
  });

  it("completes OAuth activation even when reconciliation fails", async () => {
    mockAutoDiscoverAndProfile.mockRejectedValue(new Error("discovery failed"));

    const result = await exchangeOAuthCode("state-1", "code-1");

    expect(result).toEqual({ providerId: "codex" });
    expect(mockPrisma.credentialEntry.upsert).toHaveBeenCalled();
    expect(mockAutoDiscoverAndProfile).toHaveBeenCalledWith("codex");
  });
});
