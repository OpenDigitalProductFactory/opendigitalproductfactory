import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@dpf/db", () => ({
  prisma: {
    modelProvider: {
      findUnique: vi.fn(),
      update: vi.fn(),
    },
    modelProfile: { updateMany: vi.fn() },
  },
}));

vi.mock("@/lib/ai-inference", () => ({
  callProvider: vi.fn(),
  InferenceError: class InferenceError extends Error {},
}));

vi.mock("./rate-tracker", () => ({
  recordRequest: vi.fn(),
  learnFromRateLimitResponse: vi.fn(),
  extractRetryAfterMs: vi.fn(),
  markEndpointUnavailable: vi.fn(),
  clearEndpointUnavailable: vi.fn(),
  getEndpointRuntimeState: vi.fn(() => ({ unavailable: false })),
}));

vi.mock("./rate-recovery", () => ({
  scheduleRecovery: vi.fn(),
}));

vi.mock("./loader", () => ({
  invalidateRoutingLoaderCache: vi.fn(),
}));

vi.mock("@/lib/ai-provider-internals", () => ({
  autoDiscoverAndProfile: vi.fn(),
}));

vi.mock("@/lib/provider-oauth", () => ({
  refreshOAuthToken: vi.fn(),
}));

vi.mock("./route-outcome", () => ({
  recordRouteOutcome: vi.fn(() => Promise.resolve()),
}));

import { callProvider } from "@/lib/ai-inference";
import { createResponseProducer } from "./response-producer";
import { prisma } from "@dpf/db";
import { callWithFallbackChain } from "./fallback";
import type { RouteDecision } from "./types";

const mockCallProvider = vi.mocked(callProvider);
const mockPrisma = prisma as unknown as {
  modelProvider: { findUnique: ReturnType<typeof vi.fn> };
};

const decision: RouteDecision = {
  selectedEndpoint: "prov1",
  selectedModelId: "model1",
  reason: "test",
  fitnessScore: 1,
  fallbackChain: [],
  candidates: [],
  excludedCount: 0,
  excludedReasons: [],
  policyRulesApplied: [],
  taskType: "test",
  sensitivity: "internal",
  timestamp: new Date("2026-07-30T00:00:00.000Z"),
  preferenceResolution: {
    requested: [{ kind: "provider", value: "preferred-provider" }],
    applied: [],
    unavailable: [{ kind: "provider", value: "preferred-provider" }],
    fallbackUsed: true,
  },
};

beforeEach(() => {
  vi.clearAllMocks();
  mockPrisma.modelProvider.findUnique.mockResolvedValue({
    providerId: "prov1",
    name: "Provider One",
  });
  mockCallProvider.mockResolvedValue({
    content: "hello",
    inputTokens: 100,
    outputTokens: 50,
    inferenceMs: 200,
  });
});

describe("callWithFallbackChain configured preference metadata", () => {
  it("returns only the successful fallback producer rather than the selected model", async () => {
    const content = "The fallback model produced this answer.";
    const responseProducer = createResponseProducer({ attemptId: "fallback-attempt", providerId: "prov2", modelId: "model2", content });
    mockCallProvider.mockRejectedValueOnce(new Error("selected endpoint unavailable"))
      .mockResolvedValueOnce({ content, inputTokens: 5, outputTokens: 5, inferenceMs: 20, responseProducer });
    const result = await callWithFallbackChain({ ...decision, preferenceResolution: undefined, fallbackChain: ["prov2"],
      candidates: [{ endpointId: "prov2", providerId: "prov2", modelId: "model2", endpointName: "Backup", fitnessScore: 1, dimensionScores: {}, costPerOutputMToken: null, excluded: false }] },
      [{ role: "user", content: "Answer the task." }], "system", undefined, undefined, undefined, undefined,
      { agentMessageId: "assistant-id", threadId: "thread-id" });
    expect(result).toMatchObject({ providerId: "prov2", modelId: "model2", responseProducer });
    expect(mockCallProvider).toHaveBeenCalledTimes(2);
    expect(mockCallProvider.mock.calls[1]?.[8]).toMatchObject({ agentMessageId: "assistant-id", threadId: "thread-id" });
  });
  it.each(["content", "model"])("clears a producer whose %s no longer matches the successful call", async mismatch => {
    const content = "The actual response content.";
    mockCallProvider.mockResolvedValueOnce({ content, inputTokens: 5, outputTokens: 5, inferenceMs: 20,
      responseProducer: createResponseProducer({ attemptId: "mismatched", providerId: "prov1", modelId: mismatch === "model" ? "other" : "model1", content: mismatch === "content" ? "Different generated content." : content }) });
    const result = await callWithFallbackChain(decision, [{ role: "user", content: "hi" }], "system");
    expect(result.responseProducer).toBeUndefined();
  });
  it("preserves a typed async start handle without exposing raw provider data", async () => {
    mockCallProvider.mockResolvedValueOnce({
      content: "",
      inputTokens: 0,
      outputTokens: 0,
      inferenceMs: 25,
      asyncOperation: {
        status: "accepted",
        providerOperationId: "interaction-provider-op-1",
      },
      raw: { providerOnly: "must-not-cross-fallback-boundary" },
    });

    const result = await callWithFallbackChain(
      { ...decision, preferenceResolution: undefined },
      [{ role: "user", content: "research" }],
      "system",
    );

    expect(result.asyncOperation).toEqual({
      status: "accepted",
      providerOperationId: "interaction-provider-op-1",
    });
    expect(result).not.toHaveProperty("raw");
    expect(result.downgradeReason).toBeNull();
  });

  it("reports an unavailable preference from structured routing metadata", async () => {
    await expect(
      callWithFallbackChain(
        decision,
        [{ role: "user", content: "hi" }],
        "system",
      ),
    ).resolves.toMatchObject({
      downgraded: true,
      downgradeReason: "not-eligible",
      downgradeMessage: expect.stringContaining(
        'Preferred provider "preferred-provider" is unavailable',
      ),
    });
  });
});
