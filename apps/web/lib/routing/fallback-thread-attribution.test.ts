import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@dpf/db", () => ({
  prisma: {
    modelProvider: { findUnique: vi.fn(), update: vi.fn() },
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
}));
vi.mock("./rate-recovery", () => ({ scheduleRecovery: vi.fn() }));
vi.mock("./loader", () => ({ invalidateRoutingLoaderCache: vi.fn() }));
vi.mock("@/lib/ai-provider-internals", () => ({ autoDiscoverAndProfile: vi.fn() }));
vi.mock("./route-outcome", () => ({ recordRouteOutcome: vi.fn(() => Promise.resolve()) }));

import { callProvider } from "@/lib/ai-inference";
import { prisma } from "@dpf/db";
import { callWithFallbackChain } from "./fallback";
import type { RouteDecision, SensitivityLevel } from "./types";

const mockCallProvider = vi.mocked(callProvider);
const mockProviderLookup = vi.mocked(prisma.modelProvider.findUnique);

// BI-CCF1ACBB: the per-thread cost ledger joins AdapterRunTelemetry on threadId,
// which was NULL on every row because this chain never forwarded it.
// callProvider's attribution argument is positional index 8.
function decision(): RouteDecision {
  return {
    selectedEndpoint: "prov1-endpoint",
    selectedModelId: "model1",
    reason: "test",
    fitnessScore: 1,
    fallbackChain: [],
    candidates: [{
      endpointId: "prov1-endpoint", providerId: "prov1", modelId: "model1",
      endpointName: "Provider 1", fitnessScore: 1, dimensionScores: {},
      costPerOutputMToken: null, excluded: false,
    }],
    excludedCount: 0,
    excludedReasons: [],
    policyRulesApplied: [],
    taskType: "sync.triage",
    sensitivity: "internal" as SensitivityLevel,
    timestamp: new Date(),
  };
}

const ok = { content: "hello", inputTokens: 1, outputTokens: 1, inferenceMs: 1 };
const messages = [{ role: "user" as const, content: "hi" }];

beforeEach(() => {
  vi.useFakeTimers();
  vi.clearAllMocks();
  mockProviderLookup.mockResolvedValue({ providerId: "prov1", name: "Provider 1" } as never);
  mockCallProvider.mockResolvedValue(ok as never);
});

afterEach(() => vi.useRealTimers());

describe("callWithFallbackChain thread attribution (BI-CCF1ACBB)", () => {
  it("forwards outcomeAttribution.threadId into callProvider's attribution", async () => {
    await callWithFallbackChain(decision(), messages, "system", undefined, undefined, undefined, undefined,
      { agentId: "agt_1", agentMessageId: "msg_1", threadId: "thread-1" });

    expect(mockCallProvider.mock.calls[0]?.[8]).toMatchObject({
      agentId: "agt_1", agentMessageId: "msg_1", threadId: "thread-1",
    });
  });

  it("falls back to the MCP session's threadId, as it already does for agentId", async () => {
    await callWithFallbackChain(decision(), messages, "system", undefined, undefined, undefined,
      { userId: "user-1", agentId: "agt_1", threadId: "thread-from-session" },
      { agentMessageId: "msg_1" });

    expect(mockCallProvider.mock.calls[0]?.[8]).toMatchObject({ agentId: "agt_1", threadId: "thread-from-session" });
  });

  it("passes null, never undefined, when no caller knows the thread", async () => {
    await callWithFallbackChain(decision(), messages, "system");

    expect(mockCallProvider.mock.calls[0]?.[8]).toMatchObject({ threadId: null });
  });
});
