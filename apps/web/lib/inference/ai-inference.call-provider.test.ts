import { beforeEach, describe, expect, it, vi } from "vitest";

const {
  mockPrisma,
  mockGetDecryptedCredential,
  mockGetProviderBearerToken,
  mockAdapterExecute,
  mockStartTimer,
  mockAiInferenceTokensInc,
  mockAiInferenceErrorsInc,
  mockProviderFetch,
  mockInvestmentContext,
  mockGpuFree,
  mockAcquireSlot,
  mockReleaseSlot,
} = vi.hoisted(() => ({
  mockPrisma: {
    aiProviderConnection: { findUnique: vi.fn() },
    modelProvider: {
      findUnique: vi.fn(),
    },
  },
  mockGetDecryptedCredential: vi.fn(),
  mockGetProviderBearerToken: vi.fn(),
  mockAdapterExecute: vi.fn(),
  mockStartTimer: vi.fn(),
  mockAiInferenceTokensInc: vi.fn(),
  mockAiInferenceErrorsInc: vi.fn(),
  mockProviderFetch: vi.fn(),
  mockInvestmentContext: vi.fn(),
  mockGpuFree: vi.fn(),
  mockAcquireSlot: vi.fn(),
  mockReleaseSlot: vi.fn(),
}));

vi.mock("./host-gpu-admission", () => ({ assertLocalGpuFree: mockGpuFree }));
vi.mock("@/lib/routing/local-provider-capacity", () => ({
  assertProviderDispatchCapacity: vi.fn(),
  assertLocalProviderCapacityAvailable: vi.fn(),
}));
vi.mock("./inference-admission", async importOriginal => {
  const actual = await importOriginal<typeof import("./inference-admission")>();
  return { ...actual, acquireInferenceSlot: async (...args: Parameters<typeof actual.acquireInferenceSlot>) => {
    const release = await actual.acquireInferenceSlot(...args);
    mockAcquireSlot(...args);
    return () => { release(); mockReleaseSlot(); };
  } };
});

vi.mock("../portfolio/investment-balance-server", () => ({ loadBuildInvestmentContext: mockInvestmentContext, UNRESOLVED_INVESTMENT_GUIDANCE: "Funding unresolved." }));

vi.mock("@dpf/db", () => ({
  prisma: mockPrisma,
}));

vi.mock("@/lib/ai-provider-internals", () => ({
  getDecryptedCredential: mockGetDecryptedCredential,
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
  getExecutionAdapter: vi.fn(() => ({ type: "chat", execute: mockAdapterExecute })),
  registerExecutionAdapter: vi.fn(),
}));

vi.mock("../routing/chat-adapter", () => ({}));
vi.mock("../routing/responses-adapter", () => ({}));
vi.mock("../routing/image-gen-adapter", () => ({}));
vi.mock("../routing/embedding-adapter", () => ({}));
vi.mock("../routing/transcription-adapter", () => ({}));
vi.mock("../routing/async-adapter", () => ({}));
vi.mock("./provider-inference-transport", async (importOriginal) => ({
  ...await importOriginal<typeof import("./provider-inference-transport")>(),
  providerInferenceFetch: mockProviderFetch,
}));

import { callProvider } from "./ai-inference";
import { runEndpointConcurrencyDiagnostic } from "../operate/endpoint-concurrency-diagnostic";
import { _setAdapterTelemetryWriteOverrideForTests } from "../routing/adapter-telemetry-writer";

describe("callProvider", () => {
  it.each(["stop", undefined])("observes actual local lane calls and preserves HTTP completion evidence (%s)", async finishReason => {
    const { chatAdapter } = await vi.importActual<typeof import("../routing/chat-adapter")>("../routing/chat-adapter");
    mockPrisma.modelProvider.findUnique.mockResolvedValue({
      providerId: "local", status: "active", authMethod: "none", authHeader: null,
      baseUrl: "http://provider.invalid/v1", endpoint: null,
    });
    mockAdapterExecute.mockImplementation(chatAdapter.execute);
    mockProviderFetch.mockImplementation(async () => new Response(JSON.stringify({
      choices: [{ message: { content: "READY" }, ...(finishReason ? { finish_reason: finishReason } : {}) }],
      usage: { prompt_tokens: 75, completion_tokens: 22 },
    }), { status: 200, headers: { "Content-Type": "application/json" } }));
    _setAdapterTelemetryWriteOverrideForTests(async () => {});
    try {
      const result = await runEndpointConcurrencyDiagnostic("local", "test-model");
      expect(mockProviderFetch).toHaveBeenCalledTimes(2);
      expect(mockAcquireSlot).not.toHaveBeenCalled(); // Local uses the real shared ResourceLane.
      expect(result.callers.map(c => c.content)).toEqual(["READY", "READY"]);
      expect(result.callers.map(c => c.finishReason)).toEqual([finishReason ?? null, finishReason ?? null]);
      expect(result.callers.every(c => c.released)).toBe(true);
      expect(result.contentionObserved).toBe(true);
      expect(result.outcome).toBe(finishReason ? "passed" : "deferred");
    } finally {
      _setAdapterTelemetryWriteOverrideForTests(null);
    }
  });
  it("removes a cancelled caller queued behind the shared local holder", async () => {
    mockPrisma.modelProvider.findUnique.mockResolvedValue({
      providerId: "local", status: "active", authMethod: "none",
      baseUrl: "http://localhost:12434/v1", endpoint: null,
    });
    const { withInferenceCancellation } = await import("./inference-admission");
    const { getResourceLane, LOCAL_INFERENCE_LANE_KEY, withLocalInferenceLock } =
      await import("../queue/resource-lane");
    let release!: () => void;
    let entered!: () => void;
    const held = new Promise<void>(resolve => { release = resolve; });
    const started = new Promise<void>(resolve => { entered = resolve; });
    const holder = withLocalInferenceLock(async () => { entered(); await held; });
    await started;
    const caller = new AbortController();
    const reason = new Error("utility expired in local queue");
    let observed: unknown;
    const waiting = withInferenceCancellation(caller.signal,
      () => callProvider("local", "test-model", [], "bounded utility"));
    const settled = waiting.catch(error => { observed = error; });
    try {
      await vi.waitFor(() => expect(getResourceLane(LOCAL_INFERENCE_LANE_KEY).depth()).toBe(1));
      caller.abort(reason);
      await vi.waitFor(() => expect(observed).toBe(reason));
      expect(getResourceLane(LOCAL_INFERENCE_LANE_KEY).depth()).toBe(0);
      expect(mockAdapterExecute).not.toHaveBeenCalled();
      expect(mockAcquireSlot).not.toHaveBeenCalled();
    } finally {
      release();
      await holder;
      await settled;
    }
  });

  it("retains caller cancellation when dispatch selects the parent's local transport", async () => {
    const { withInferenceCancellation } = await import("./inference-admission");
    const caller = new AbortController();
    const reason = new Error("utility expired during governed dispatch");
    mockPrisma.modelProvider.findUnique.mockResolvedValue({
      providerId: "local", status: "active", authMethod: "none",
      baseUrl: "http://127.0.0.1:1", endpoint: null,
    });
    mockAdapterExecute.mockImplementationOnce(context => {
      caller.abort(reason);
      return context.fetchImpl("http://127.0.0.1:1/");
    });
    await expect(withGovernedInferenceDeadline({ deadlineAt: new Date(Date.now() + 60_000).toISOString(),
      verifyAuthority: async () => true }, () => withInferenceCancellation(caller.signal,
      () => callProvider("local", "test-model", [], "bounded utility"))))
      .rejects.toBe(reason);
    expect(mockAdapterExecute).toHaveBeenCalledOnce();
    expect(mockProviderFetch).not.toHaveBeenCalled();
  });

  beforeEach(() => {
    vi.clearAllMocks();
    mockAdapterExecute.mockReset();
    mockInvestmentContext.mockResolvedValue({ snapshot: null, guidance: "Funding unresolved." });
    mockGpuFree.mockReset().mockResolvedValue(undefined);
    mockAdapterExecute.mockReset();
    mockPrisma.aiProviderConnection.findUnique.mockResolvedValue({ status: "active" });
    mockStartTimer.mockReturnValue(vi.fn());
    mockAdapterExecute.mockResolvedValue({
      text: "ok",
      toolCalls: [],
      usage: { inputTokens: 4, outputTokens: 2 },
      inferenceMs: 12,
      raw: {},
    });
  });

  it("waits for admission before inspecting the GPU and releases on deferral", async () => {
    mockPrisma.modelProvider.findUnique.mockResolvedValue({
      providerId: "openai", status: "active", authMethod: "api_key", authHeader: "Authorization",
      baseUrl: "https://api.openai.com/v1", endpoint: null,
    });
    mockGetDecryptedCredential.mockResolvedValue({ secretRef: "test-key" });
    const busy = new Error("GPU busy");
    mockGpuFree.mockRejectedValueOnce(busy);
    await expect(callProvider("openai", "model", [{ role: "user", content: "Hi" }], "Help"))
      .rejects.toBe(busy);
    expect(mockAcquireSlot.mock.invocationCallOrder[0]).toBeLessThan(mockGpuFree.mock.invocationCallOrder[0]);
    expect(mockReleaseSlot).toHaveBeenCalledOnce();
    expect(mockAdapterExecute).not.toHaveBeenCalled();
  });

  it("delegates local chat host checks to the shared lane instead of rejecting an active build", async () => {
    mockPrisma.modelProvider.findUnique.mockResolvedValue({
      providerId: "local", status: "active", authMethod: "none", authHeader: null,
      baseUrl: "http://localhost:12434/v1", endpoint: null,
    });
    await expect(callProvider("local", "local-model", [{ role: "user", content: "Hi" }], "Help"))
      .resolves.toMatchObject({ content: "ok" });
    expect(mockGpuFree).toHaveBeenCalledOnce();
    expect(mockGpuFree.mock.invocationCallOrder[0]).toBeLessThan(mockAdapterExecute.mock.invocationCallOrder[0]);
    expect(mockAcquireSlot).not.toHaveBeenCalled();
    expect(mockReleaseSlot).not.toHaveBeenCalled();
  });

  it.each([false, true])("captures funding before dispatch and preserves it when error=%s", async (fails) => {
    mockPrisma.modelProvider.findUnique.mockResolvedValue({ providerId: "openai", status: "active", authMethod: "api_key", authHeader: "Authorization", baseUrl: "https://api.openai.com/v1", endpoint: null });
    mockGetDecryptedCredential.mockResolvedValue({ secretRef: "test-key" });
    const snapshot = { investmentPrincipalId: "original-owner", investmentOrganizationId: "org", investmentItemId: "item", investmentPurpose: "sharedPlatform", investmentClass: "refactor", investmentPolicyRef: "revision", investmentInstallationRef: "install", investmentCapturedAt: new Date() };
    mockInvestmentContext.mockResolvedValue({ snapshot, guidance: "Scoped target: 80% refactoring." });
    mockAdapterExecute.mockImplementation(async (request) => {
      expect(mockInvestmentContext).toHaveBeenCalledWith(mockPrisma, "build-1");
      expect(request.systemPrompt).toContain("Scoped target: 80% refactoring.");
      // A later ownership change must not cause a second resolution for telemetry.
      mockInvestmentContext.mockResolvedValue({ snapshot: { ...snapshot, investmentPrincipalId: "new-owner" }, guidance: "Changed" });
      if (fails) throw new Error("provider failed");
      return { text: "ok", toolCalls: [], usage: { inputTokens: 4, outputTokens: 2 }, inferenceMs: 1, raw: {} };
    });
    const write = vi.fn().mockResolvedValue(undefined);
    _setAdapterTelemetryWriteOverrideForTests(write);
    try {
      const run = callProvider("openai", "test", [], "system", undefined, undefined, undefined, undefined, { buildId: "build-1" });
      if (fails) await expect(run).rejects.toThrow("provider failed");
      else await run;
      await new Promise((resolve) => setImmediate(resolve));
      expect(mockInvestmentContext).toHaveBeenCalledTimes(1);
      expect(write).toHaveBeenCalledWith(expect.objectContaining(snapshot));
    } finally { _setAdapterTelemetryWriteOverrideForTests(null); }
  });

  it.each(["active", "degraded"])("preserves %s legacy activation while its default account is unconfigured", async status => {
    mockPrisma.aiProviderConnection.findUnique.mockResolvedValue({ status: "unconfigured" });
    mockPrisma.modelProvider.findUnique.mockResolvedValue({ providerId: "openai", status, authMethod: "api_key", authHeader: "Authorization", baseUrl: "https://api.openai.com/v1", endpoint: null });
    mockGetDecryptedCredential.mockResolvedValue({ secretRef: "test-key" });
    await expect(callProvider("openai", "model-under-test", [], "system")).resolves.toMatchObject({ content: "ok" });
    expect(mockAdapterExecute).toHaveBeenCalledOnce();
  });
  it("keeps an unconfigured provider blocked when its default account is unconfigured", async () => {
    mockPrisma.aiProviderConnection.findUnique.mockResolvedValue({ status: "unconfigured" });
    mockPrisma.modelProvider.findUnique.mockResolvedValue({ status: "unconfigured" });
    await expect(callProvider("openai", "model-under-test", [], "system")).rejects.toThrow("not enabled for routing");
    expect(mockAdapterExecute).not.toHaveBeenCalled();
  });
  it("does not dispatch a cloud provider while its account is paused", async () => {
    mockPrisma.aiProviderConnection.findUnique.mockResolvedValue({ status: "paused" });
    await expect(callProvider("chatgpt", "model-under-test", [], "system")).rejects.toThrow("not enabled for routing");
    expect(mockAdapterExecute).not.toHaveBeenCalled();
  });

  it("omits async-operation metadata for a synchronous adapter result", async () => {
    mockPrisma.modelProvider.findUnique.mockResolvedValue({
      providerId: "openai",
      status: "active",
      authMethod: "api_key",
      authHeader: "Authorization",
      baseUrl: "https://api.openai.com/v1",
      endpoint: null,
    });
    mockGetDecryptedCredential.mockResolvedValueOnce({ secretRef: "test-key" });

    const result = await callProvider(
      "openai",
      "model-under-test",
      [{ role: "user", content: "Answer synchronously" }],
      "You are helpful.",
    );

    expect(result).not.toHaveProperty("asyncOperation");
    expect(mockAdapterExecute).toHaveBeenCalledWith(expect.objectContaining({
      fetchImpl: mockProviderFetch,
    }));
  });

  it("passes the configured Anthropic workspace to the execution adapter", async () => {
    mockPrisma.modelProvider.findUnique.mockResolvedValue({ providerId: "anthropic", status: "active", authMethod: "api_key", authHeader: "x-api-key", baseUrl: "https://api.anthropic.com/v1", endpoint: null });
    mockGetDecryptedCredential.mockResolvedValueOnce({ secretRef: "test-key", providerWorkspaceId: "wrkspc_accountA" });
    await callProvider("anthropic", "claude-model", [{ role: "user", content: "hi" }], "system");
    expect(mockAdapterExecute).toHaveBeenCalledWith(expect.objectContaining({ provider: expect.objectContaining({ headers: expect.objectContaining({ "anthropic-workspace-id": "wrkspc_accountA", "x-api-key": "test-key" }) }) }));
  });

  it("routes Codex OAuth execution through the ChatGPT backend", async () => {
    mockPrisma.modelProvider.findUnique.mockImplementation(({ where }: { where: { providerId: string } }) => {
      if (where.providerId === "codex") {
        return Promise.resolve({
          providerId: "codex",
          status: "active",
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

  it("projects typed async-operation start metadata from the adapter", async () => {
    mockPrisma.modelProvider.findUnique.mockResolvedValue({
      providerId: "gemini",
      status: "active",
      authMethod: "api_key",
      authHeader: "x-goog-api-key",
      baseUrl: "https://generativelanguage.googleapis.com/v1beta",
      endpoint: null,
    });
    mockGetDecryptedCredential.mockResolvedValueOnce({ secretRef: "test-key" });
    mockAdapterExecute.mockResolvedValueOnce({
      text: "",
      toolCalls: [],
      usage: { inputTokens: 0, outputTokens: 0 },
      inferenceMs: 12,
      asyncOperation: {
        status: "accepted",
        providerOperationId: "operations/provider-op-1",
      },
    });

    const result = await callProvider(
      "gemini",
      "model-under-test",
      [{ role: "user", content: "Research this" }],
      "You research.",
      undefined,
      {
        providerId: "gemini",
        modelId: "model-under-test",
        recipeId: null,
        contractFamily: "background.research",
        executionAdapter: "async",
        maxTokens: 0,
        providerSettings: {},
        toolPolicy: {},
        responsePolicy: {},
      },
    );

    expect(result.asyncOperation).toEqual({
      status: "accepted",
      providerOperationId: "operations/provider-op-1",
    });
  });

  it("forwards attribution.agentMessageId into AdapterRunTelemetry on the success path", async () => {
    // Regression for PR #964 follow-up: the assistant-turn badge query joins
    // AdapterRunTelemetry → AgentMessage on agentMessageId. callProvider is
    // the only site that writes telemetry rows for the coworker turn, so the
    // pre-allocated id has to make it through `attribution` into both writer
    // call sites (success + error).
    mockPrisma.modelProvider.findUnique.mockResolvedValue({
      providerId: "anthropic",
      status: "active",
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
      status: "active",
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
    )).rejects.toMatchObject({
      code: "provider_error",
      message: expect.stringMatching(/cannot enforce required tool choice/i),
    });
    expect(mockAdapterExecute).not.toHaveBeenCalled();
  });

  it.each([
    ["anthropic-sub", "claude-sonnet-4-6", "claude-cli", "record_initiative_evidence"],
    ["codex", "gpt-5.4", "codex-cli", "record_initiative_design_review"],
  ])("dispatches %s/%s through its CLI adapter under the receipt-verified contract", async (
    providerId,
    modelId,
    executionAdapter,
    writerToolName,
  ) => {
    mockPrisma.modelProvider.findUnique.mockResolvedValue({
      providerId,
      status: "active",
      authMethod: "oauth2_authorization_code",
      authHeader: "Authorization",
      baseUrl: providerId === "codex" ? "https://api.openai.com/v1" : null,
      endpoint: null,
    });

    const dispatch = callProvider(
      providerId,
      modelId,
      [{ role: "user", content: "Record it." }],
      "Use the sole governed writer.",
      [{ type: "function", function: { name: writerToolName, parameters: {} } }],
      {
        providerId,
        modelId,
        recipeId: null,
        contractFamily: "sync.review",
        executionAdapter,
        maxTokens: 1024,
        providerSettings: {},
        toolPolicy: { toolChoice: "required" },
        responsePolicy: { terminalWriterToolName: writerToolName },
      },
      undefined,
      { userId: "user-1", agentId: "reviewer-1", threadId: "thread-1", routeContext: "external-mcp" },
    );

    // BI-C35576A9: the writer is reachable through the governed MCP session, so
    // the turn runs and the EXECUTOR verifies the receipt afterwards. The adapter
    // receives best-effort tool choice with the writer still the sole tool.
    mockAdapterExecute.mockResolvedValueOnce({
      text: "",
      toolCalls: [],
      usage: { inputTokens: 1, outputTokens: 1 },
      inferenceMs: 1,
      raw: {},
    });
    await expect(dispatch).resolves.toBeDefined();
    expect(mockAdapterExecute).toHaveBeenCalledTimes(1);
    const executeArgs = mockAdapterExecute.mock.calls[0] ?? [];
    const dispatched = JSON.stringify(executeArgs);
    expect(dispatched).toContain('"toolChoice":"auto"');
    expect(dispatched).not.toContain('"toolChoice":"required"');
    expect(dispatched).toContain(writerToolName);
  });

  it("keeps a sole required writer available to a provider-native HTTP adapter", async () => {
    mockPrisma.modelProvider.findUnique.mockResolvedValue({
      providerId: "openai",
      status: "active",
      authMethod: "api_key",
      authHeader: "Authorization",
      baseUrl: "https://api.openai.com/v1",
      endpoint: null,
    });
    mockGetDecryptedCredential.mockResolvedValue({ secretRef: "key" });

    await callProvider(
      "openai",
      "gpt-5.4",
      [{ role: "user", content: "Record it." }],
      "Use the sole governed writer.",
      [{ type: "function", function: { name: "record_initiative_evidence", parameters: {} } }],
      {
        providerId: "openai",
        modelId: "gpt-5.4",
        recipeId: null,
        contractFamily: "sync.review",
        executionAdapter: "chat",
        maxTokens: 1024,
        providerSettings: {},
        toolPolicy: { toolChoice: "required" },
        responsePolicy: { terminalWriterToolName: "record_initiative_evidence" },
      },
    );

    expect(mockAdapterExecute).toHaveBeenCalledWith(expect.objectContaining({
      providerId: "openai",
      plan: expect.objectContaining({
        executionAdapter: "chat",
        toolPolicy: { toolChoice: "required" },
      }),
    }));
  });

  it("rejects a terminal-writer marker when more than one tool is attached", async () => {
    mockPrisma.modelProvider.findUnique.mockResolvedValue({
      providerId: "codex",
      status: "active",
      authMethod: "oauth2_authorization_code",
      authHeader: "Authorization",
      baseUrl: "https://api.openai.com/v1",
      endpoint: null,
    });

    await expect(callProvider(
      "codex",
      "gpt-5.4",
      [{ role: "user", content: "Record it." }],
      "Use the writer.",
      [
        { type: "function", function: { name: "read_source_at_version", parameters: {} } },
        { type: "function", function: { name: "record_initiative_evidence", parameters: {} } },
      ],
      {
        providerId: "codex",
        modelId: "gpt-5.4",
        recipeId: null,
        contractFamily: "sync.review",
        executionAdapter: "codex-cli",
        maxTokens: 1024,
        providerSettings: {},
        toolPolicy: { toolChoice: "required" },
        responsePolicy: { terminalWriterToolName: "record_initiative_evidence" },
      },
      undefined,
      { userId: "user-1", agentId: "reviewer-1", threadId: "thread-1", routeContext: "external-mcp" },
    )).rejects.toThrow(/cannot enforce required tool choice/i);
    expect(mockAdapterExecute).not.toHaveBeenCalled();
  });

  it("rejects a terminal-writer marker that does not exactly match the sole tool", async () => {
    mockPrisma.modelProvider.findUnique.mockResolvedValue({
      providerId: "anthropic-sub",
      status: "active",
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
      [{ type: "function", function: { name: "record_initiative_evidence", parameters: {} } }],
      {
        providerId: "anthropic-sub",
        modelId: "claude-sonnet-4-6",
        recipeId: null,
        contractFamily: "sync.review",
        executionAdapter: "claude-cli",
        maxTokens: 1024,
        providerSettings: {},
        toolPolicy: { toolChoice: "required" },
        responsePolicy: { terminalWriterToolName: "different_writer" },
      },
    )).rejects.toThrow(/cannot enforce required tool choice/i);
    expect(mockAdapterExecute).not.toHaveBeenCalled();
  });

  it("rejects a matching terminal-writer marker without a governed MCP session", async () => {
    mockPrisma.modelProvider.findUnique.mockResolvedValue({
      providerId: "anthropic-sub",
      status: "active",
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
      [{ type: "function", function: { name: "record_initiative_evidence", parameters: {} } }],
      {
        providerId: "anthropic-sub",
        modelId: "claude-sonnet-4-6",
        recipeId: null,
        contractFamily: "sync.review",
        executionAdapter: "claude-cli",
        maxTokens: 1024,
        providerSettings: {},
        toolPolicy: { toolChoice: "required" },
        responsePolicy: { terminalWriterToolName: "record_initiative_evidence" },
      },
    )).rejects.toThrow(/cannot enforce required tool choice/i);
    expect(mockAdapterExecute).not.toHaveBeenCalled();
  });
});

import { withGovernedInferenceDeadline } from "@/lib/routing/governed-inference-deadline";

it("blocks every paid fallback before adapter dispatch when parent authority is lost", async () => {
  vi.clearAllMocks();
  let valid = true;
  await withGovernedInferenceDeadline({ deadlineAt: new Date(Date.now() + 60_000).toISOString(),
    verifyAuthority: async () => valid }, async () => {
    valid = false;
    for (const provider of ["openai", "anthropic-sub", "codex"]) {
      await expect(callProvider(provider, "review-model", [], "Review the diff"))
        .rejects.toThrow("authority-lost");
    }
  });
  expect(mockAdapterExecute).not.toHaveBeenCalled();
  expect(mockPrisma.modelProvider.findUnique).not.toHaveBeenCalled();
});
