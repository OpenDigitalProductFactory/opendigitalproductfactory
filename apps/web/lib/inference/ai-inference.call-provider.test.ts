import { beforeEach, describe, expect, it, vi } from "vitest";

const {
  mockPrisma,
  mockGetProviderBearerToken,
  mockAdapterExecute,
  mockStartTimer,
  mockAiInferenceTokensInc,
  mockAiInferenceErrorsInc,
} = vi.hoisted(() => ({
  mockPrisma: {
    modelProvider: {
      findUnique: vi.fn(),
    },
  },
  mockGetProviderBearerToken: vi.fn(),
  mockAdapterExecute: vi.fn(),
  mockStartTimer: vi.fn(),
  mockAiInferenceTokensInc: vi.fn(),
  mockAiInferenceErrorsInc: vi.fn(),
}));

vi.mock("@dpf/db", () => ({
  prisma: mockPrisma,
}));

vi.mock("@/lib/ai-provider-internals", () => ({
  getDecryptedCredential: vi.fn(),
  getProviderExtraHeaders: vi.fn(() => ({})),
  getProviderBearerToken: mockGetProviderBearerToken,
  isAnthropicProvider: vi.fn(() => false),
  ANTHROPIC_OAUTH_BETA_HEADERS: "oauth-2025-04-20",
}));

vi.mock("@/lib/metrics", () => ({
  aiInferenceDuration: { startTimer: mockStartTimer },
  aiInferenceTokens: { inc: mockAiInferenceTokensInc },
  aiInferenceErrors: { inc: mockAiInferenceErrorsInc },
  aiInferenceCostUsd: { inc: vi.fn() },
}));

vi.mock("../routing/execution-adapter-registry", () => ({
  getExecutionAdapter: vi.fn(() => ({ execute: mockAdapterExecute })),
}));

vi.mock("../routing/chat-adapter", () => ({}));
vi.mock("../routing/responses-adapter", () => ({}));
vi.mock("../routing/image-gen-adapter", () => ({}));
vi.mock("../routing/embedding-adapter", () => ({}));
vi.mock("../routing/transcription-adapter", () => ({}));
vi.mock("../routing/async-adapter", () => ({}));

import { callProvider } from "./ai-inference";

describe("callProvider", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockStartTimer.mockReturnValue(vi.fn());
    mockAdapterExecute.mockResolvedValue({
      text: "ok",
      toolCalls: [],
      usage: { inputTokens: 4, outputTokens: 2 },
      inferenceMs: 12,
      raw: {},
    });
  });

  it("routes Codex OAuth execution through the ChatGPT backend", async () => {
    mockPrisma.modelProvider.findUnique.mockImplementation(({ where }: { where: { providerId: string } }) => {
      if (where.providerId === "codex") {
        return Promise.resolve({
          providerId: "codex",
          authMethod: "oauth2_authorization_code",
          authHeader: "Authorization",
          baseUrl: "https://api.openai.com/v1",
          endpoint: null,
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
    mockGetProviderBearerToken.mockResolvedValue({ token: "oauth-token" });

    await callProvider(
      "codex",
      "gpt-5-codex",
      [{ role: "user", content: "Build it" }],
      "You are helpful.",
      undefined,
      {
        providerId: "codex",
        modelId: "gpt-5-codex",
        recipeId: null,
        contractFamily: "sync.code-gen",
        executionAdapter: "responses",
        maxTokens: 1024,
        providerSettings: {},
        toolPolicy: {},
        responsePolicy: {},
      },
    );

    expect(mockAdapterExecute).toHaveBeenCalledWith(
      expect.objectContaining({
        providerId: "codex",
        provider: expect.objectContaining({
          baseUrl: "https://chatgpt.com/backend-api",
          headers: expect.objectContaining({
            Authorization: "Bearer oauth-token",
            "Content-Type": "application/json",
          }),
        }),
      }),
    );
  });
});
