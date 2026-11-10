import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@dpf/db", () => ({
  prisma: {
    modelProvider: { findUnique: vi.fn(), update: vi.fn() },
    modelProfile: { updateMany: vi.fn() },
    aiProviderConnection: { updateMany: vi.fn() },
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
vi.mock("./provider-auto-disable", () => ({ autoDisableProvider: vi.fn() }));
vi.mock("./route-outcome", () => ({ recordRouteOutcome: vi.fn(() => Promise.resolve()) }));

import { callProvider } from "@/lib/ai-inference";
import { prisma } from "@dpf/db";
import { callWithFallbackChain } from "./fallback";
import { AgentAllowanceExhaustedError } from "@/lib/inference/budget-gate";
import { markEndpointUnavailable } from "./rate-tracker";
import { autoDisableProvider } from "./provider-auto-disable";
import type { RouteDecision, SensitivityLevel } from "./types";

const mockCallProvider = vi.mocked(callProvider);
const mockProviderLookup = vi.mocked(prisma.modelProvider.findUnique);

function paidThenFree(): RouteDecision {
  return {
    selectedEndpoint: "cloud-endpoint",
    selectedModelId: "claude-paid",
    reason: "test",
    fitnessScore: 1,
    fallbackChain: ["local-endpoint"],
    candidates: [
      {
        endpointId: "cloud-endpoint", providerId: "anthropic", modelId: "claude-paid",
        endpointName: "Paid API", fitnessScore: 1, dimensionScores: {},
        costPerOutputMToken: null, excluded: false,
      },
      {
        endpointId: "local-endpoint", providerId: "local", modelId: "qwen3-coder",
        endpointName: "Local", fitnessScore: 0.8, dimensionScores: {},
        costPerOutputMToken: null, excluded: false,
      },
    ],
    excludedCount: 0,
    excludedReasons: [],
    policyRulesApplied: [],
    taskType: "build-review",
    sensitivity: "internal" as SensitivityLevel,
    timestamp: new Date(),
  };
}

const refusal = () => new AgentAllowanceExhaustedError({ agentId: "change-reviewer",
  budget: { status: "rejected", actualTokens: 200_001, limitTokens: 200_000, ratioPercent: 100, governedBy: "agent-cap" } });

beforeEach(() => {
  vi.useFakeTimers();
  vi.clearAllMocks();
  mockProviderLookup.mockResolvedValue({ providerId: "anthropic", name: "Paid API" } as never);
});

afterEach(() => vi.useRealTimers());

// BI-F3B6713F: a used allowance was thrown as a provider "billing" failure, so
// routing degraded the local model for everyone and would have disabled a paid
// provider. It is the platform's own limit, not a fault in any endpoint.
describe("fallback when the paid AI allowance is used", () => {
  it("moves on to a free endpoint without degrading, cooling or disabling the paid one", async () => {
    mockCallProvider
      .mockRejectedValueOnce(refusal())
      .mockResolvedValueOnce({ content: "reviewed", inputTokens: 4, outputTokens: 2, inferenceMs: 20 } as never);
    const pending = callWithFallbackChain(paidThenFree(), [{ role: "user", content: "review" }], "system");
    await vi.runAllTimersAsync();
    await expect(pending).resolves.toMatchObject({ providerId: "local", content: "reviewed" });
    expect(markEndpointUnavailable).not.toHaveBeenCalled();
    expect(autoDisableProvider).not.toHaveBeenCalled();
    expect(prisma.modelProvider.update).not.toHaveBeenCalled();
    expect(prisma.modelProfile.updateMany).not.toHaveBeenCalled();
    expect(prisma.aiProviderConnection.updateMany).not.toHaveBeenCalled();
  });

  it("surfaces the typed allowance refusal, not 'All endpoints failed', when every endpoint refused", async () => {
    mockCallProvider.mockRejectedValueOnce(refusal()).mockRejectedValueOnce(refusal());
    const pending = callWithFallbackChain(paidThenFree(), [{ role: "user", content: "review" }], "system").catch((error: unknown) => error);
    await vi.runAllTimersAsync();
    const error = await pending;
    expect(error).toBeInstanceOf(AgentAllowanceExhaustedError);
    expect(error).toMatchObject({ code: "daily-allowance-used", resetAt: expect.stringMatching(/T00:00:00\.000Z$/) });
    expect(markEndpointUnavailable).not.toHaveBeenCalled();
    expect(autoDisableProvider).not.toHaveBeenCalled();
  });
});
