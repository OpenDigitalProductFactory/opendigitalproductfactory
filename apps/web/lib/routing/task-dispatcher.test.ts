import { describe, it, expect, vi, beforeEach } from "vitest";
import { callWithFallbackChain, NoEndpointAvailableError } from "./task-dispatcher";
import type { TaskRouteDecision, CandidateTrace } from "./task-router-types";
import type { ProviderCallPayload, DispatchContext } from "./task-dispatcher";

// ── Mocks ─────────────────────────────────────────────────────────────────────

// Must match the actual import path in task-dispatcher.ts
const mockPrisma = {
  modelProvider: { update: vi.fn() },
  routeDecisionLog: { create: vi.fn().mockResolvedValue({ id: "log-1" }) },
};
vi.mock("@dpf/db", () => ({ prisma: mockPrisma }));

const mockCallProvider = vi.fn();
const mockLogTokenUsage = vi.fn().mockResolvedValue(undefined);
vi.mock("@/lib/ai-inference", () => ({
  callProvider: (...args: unknown[]) => mockCallProvider(...args),
  logTokenUsage: (...args: unknown[]) => mockLogTokenUsage(...args),
  InferenceError: class extends Error {
    code: string;
    providerId: string;
    constructor(message: string, code: string, providerId = "ep-1") {
      super(message);
      this.name = "InferenceError";
      this.code = code;
      this.providerId = providerId;
    }
  },
}));

const mockObserve = vi.fn();
vi.mock("@/lib/process-observer", () => ({ observe: mockObserve }));

// ── Fixtures ──────────────────────────────────────────────────────────────────

function makeCandidate(overrides: Partial<CandidateTrace> = {}): CandidateTrace {
  return {
    endpointId: "ep-1",
    providerId: "provider-1",
    modelId: "model-a",
    endpointName: "Endpoint 1",
    fitnessScore: 100,
    dimensionScores: {},
    costPerOutputMToken: 3.0,
    excluded: false,
    ...overrides,
  };
}

const mockDecision: TaskRouteDecision = {
  selectedEndpointId: "ep-1",
  selectedProviderId: "provider-1",
  selectedModelId: "model-a",
  fallbackChain: ["ep-2", "ep-3"],
  candidates: [
    makeCandidate({ endpointId: "ep-1", providerId: "provider-1", modelId: "model-a", fitnessScore: 100 }),
    makeCandidate({ endpointId: "ep-2", providerId: "provider-2", modelId: "model-b", fitnessScore: 90 }),
    makeCandidate({ endpointId: "ep-3", providerId: "provider-3", modelId: "model-c", fitnessScore: 80 }),
  ],
  reason: "test routing",
  excludedCount: 0,
  excludedReasons: {},
  policyRulesApplied: [],
  taskType: "test",
  sensitivity: "internal",
  timestamp: new Date(),
};

const mockPayload: ProviderCallPayload = {
  modelId: "model-a",
  messages: [{ role: "user", content: "Hello" }],
  systemPrompt: "You are a test assistant.",
};

const mockContext: DispatchContext = {
  agentId: "test-agent",
  agentMessageId: "msg-1",
};

// ── Tests ─────────────────────────────────────────────────────────────────────

describe("callWithFallbackChain", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockPrisma.routeDecisionLog.create.mockResolvedValue({ id: "log-1" });
  });

  it("calls callProvider with correct (providerId, modelId, messages, systemPrompt) args and returns on success", async () => {
    mockCallProvider.mockResolvedValueOnce({
      content: "success",
      inputTokens: 10,
      outputTokens: 20,
      inferenceMs: 500,
    });

    const result = await callWithFallbackChain(mockDecision, mockPayload, mockContext);

    expect(result.content).toBe("success");
    expect(mockCallProvider).toHaveBeenCalledOnce();
    expect(mockCallProvider).toHaveBeenCalledWith(
      "provider-1",
      "model-a",
      mockPayload.messages,
      mockPayload.systemPrompt,
      undefined, // no tools
    );
    expect(mockPrisma.routeDecisionLog.create).toHaveBeenCalledOnce();
    expect(mockObserve).toHaveBeenCalledWith("ai_call_succeeded", expect.any(Object));
  });

  it("logs token usage with correct shape after success", async () => {
    mockCallProvider.mockResolvedValueOnce({
      content: "ok",
      inputTokens: 5,
      outputTokens: 15,
      inferenceMs: 300,
    });

    await callWithFallbackChain(mockDecision, mockPayload, mockContext);

    expect(mockLogTokenUsage).toHaveBeenCalledWith({
      agentId: "test-agent",
      providerId: "provider-1",
      contextKey: "msg-1",
      inputTokens: 5,
      outputTokens: 15,
      inferenceMs: 300,
    });
  });

  it("tries fallback chain in order on transient failure", async () => {
    mockCallProvider
      .mockRejectedValueOnce(new Error("Transient failure"))
      .mockResolvedValueOnce({ content: "fallback success", inputTokens: 1, outputTokens: 1, inferenceMs: 100 });

    const result = await callWithFallbackChain(mockDecision, mockPayload, mockContext);

    expect(result.content).toBe("fallback success");
    expect(mockCallProvider).toHaveBeenCalledTimes(2);
    expect(mockCallProvider).toHaveBeenNthCalledWith(1, "provider-1", expect.any(String), expect.any(Array), expect.any(String), undefined);
    expect(mockCallProvider).toHaveBeenNthCalledWith(2, "provider-2", expect.any(String), expect.any(Array), expect.any(String), undefined);
  });

  it("marks provider as degraded on rate_limit error then tries next", async () => {
    const { InferenceError } = await import("@/lib/ai-inference");
    mockCallProvider
      .mockRejectedValueOnce(new InferenceError("Rate limited", "rate_limit", "provider-1"))
      .mockResolvedValueOnce({ content: "ok", inputTokens: 1, outputTokens: 1, inferenceMs: 100 });

    await callWithFallbackChain(mockDecision, mockPayload, mockContext);

    expect(mockPrisma.modelProvider.update).toHaveBeenCalledWith({
      where: { providerId: "provider-1" },
      data: { status: "degraded" },
    });
    expect(mockCallProvider).toHaveBeenCalledTimes(2);
  });

  it("marks provider as disabled on auth error and tries next", async () => {
    const { InferenceError } = await import("@/lib/ai-inference");
    mockCallProvider
      .mockRejectedValueOnce(new InferenceError("Auth failed", "auth", "provider-1"))
      .mockResolvedValueOnce({ content: "ok", inputTokens: 1, outputTokens: 1, inferenceMs: 100 });

    await callWithFallbackChain(mockDecision, mockPayload, mockContext);

    expect(mockPrisma.modelProvider.update).toHaveBeenCalledWith({
      where: { providerId: "provider-1" },
      data: { status: "disabled" },
    });
  });

  it("throws NoEndpointAvailableError when entire chain fails", async () => {
    mockCallProvider.mockRejectedValue(new Error("Persistent failure"));

    await expect(
      callWithFallbackChain(mockDecision, mockPayload, mockContext),
    ).rejects.toThrow(NoEndpointAvailableError);

    // All 3 endpoints tried
    expect(mockCallProvider).toHaveBeenCalledTimes(3);
    // Failure log persisted with empty sentinel for selectedEndpointId
    const logData = mockPrisma.routeDecisionLog.create.mock.calls[0][0].data;
    expect(logData.selectedEndpointId).toBe("");
    expect(JSON.parse(logData.fallbacksUsed)).toHaveLength(3);
  });
});
