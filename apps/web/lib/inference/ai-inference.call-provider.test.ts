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
  registerExecutionAdapter: vi.fn(),
}));

vi.mock("../routing/chat-adapter", () => ({}));
vi.mock("../routing/responses-adapter", () => ({}));
vi.mock("../routing/image-gen-adapter", () => ({}));
vi.mock("../routing/embedding-adapter", () => ({}));
vi.mock("../routing/transcription-adapter", () => ({}));
vi.mock("../routing/async-adapter", () => ({}));

import { callProvider } from "./ai-inference";
import { _setAdapterTelemetryWriteOverrideForTests } from "../routing/adapter-telemetry-writer";

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
      "gpt-5.3-codex",
      [{ role: "user", content: "Build it" }],
      "You are helpful.",
      undefined,
      {
        providerId: "codex",
        modelId: "gpt-5.3-codex",
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

  it("forwards attribution.agentMessageId into AdapterRunTelemetry on the success path", async () => {
    // Regression for PR #964 follow-up: the assistant-turn badge query joins
    // AdapterRunTelemetry → AgentMessage on agentMessageId. callProvider is
    // the only site that writes telemetry rows for the coworker turn, so the
    // pre-allocated id has to make it through `attribution` into both writer
    // call sites (success + error).
    mockPrisma.modelProvider.findUnique.mockResolvedValue({
      providerId: "anthropic",
      authMethod: "oauth2_authorization_code",
      authHeader: "Authorization",
      baseUrl: "https://api.anthropic.com",
      endpoint: null,
    });
    mockGetProviderBearerToken.mockResolvedValue({ token: "tok-1" });

    const writeSpy = vi.fn().mockResolvedValue(undefined);
    _setAdapterTelemetryWriteOverrideForTests(writeSpy);
    try {
      await callProvider(
        "anthropic",
        "claude-sonnet-4-6",
        [{ role: "user", content: "hi" }],
        "You are helpful.",
        undefined,
        undefined,
        undefined,
        undefined,
        { agentId: "agt_1", threadId: "thr_1", agentMessageId: "msg_pending_42" },
      );
    } finally {
      // wait a microtask so the void-write resolves before assertions
      await new Promise((r) => setImmediate(r));
      _setAdapterTelemetryWriteOverrideForTests(null);
    }

    expect(writeSpy).toHaveBeenCalledWith(
      expect.objectContaining({
        status: "success",
        agentMessageId: "msg_pending_42",
      }),
    );
  });

  it("fails closed when a CLI adapter cannot enforce required tool choice", async () => {
    mockPrisma.modelProvider.findUnique.mockResolvedValue({
      providerId: "anthropic-sub",
      authMethod: "oauth2_authorization_code",
      authHeader: "Authorization",
      baseUrl: null,
      endpoint: null,
    });

    await expect(callProvider(
      "anthropic-sub",
      "claude-sonnet-4-6",
      [{ role: "user", content: "Record it." }],
      "Use the writer.",
      [{ type: "function", function: { name: "record_review", parameters: {} } }],
      {
        providerId: "anthropic-sub",
        modelId: "claude-sonnet-4-6",
        recipeId: null,
        contractFamily: "sync.review",
        executionAdapter: "claude-cli",
        maxTokens: 1024,
        providerSettings: {},
        toolPolicy: { toolChoice: "required" },
        responsePolicy: {},
      },
    )).rejects.toThrow(/cannot enforce required tool choice/i);
    expect(mockAdapterExecute).not.toHaveBeenCalled();
  });
});
