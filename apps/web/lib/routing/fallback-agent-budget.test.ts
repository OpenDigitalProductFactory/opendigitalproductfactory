import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@dpf/db", () => ({
  prisma: {
    modelProvider: { findUnique: vi.fn(), update: vi.fn() },
    modelProfile: { updateMany: vi.fn() },
  },
}));
vi.mock("@/lib/ai-inference", () => ({ callProvider: vi.fn(), InferenceError: class InferenceError extends Error {} }));
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
vi.mock("./provider-auto-disable", () => ({ autoDisableProvider: vi.fn(() => Promise.resolve()) }));

import { callProvider } from "@/lib/ai-inference";
import { prisma } from "@dpf/db";
import { callWithFallbackChain } from "./fallback";
import { AgentBudgetExhaustedError } from "./inference-error";
import { markEndpointUnavailable } from "./rate-tracker";
import { autoDisableProvider } from "./provider-auto-disable";
import type { RouteDecision, SensitivityLevel } from "./types";

const mockCallProvider = vi.mocked(callProvider);

function decision(): RouteDecision {
  return {
    selectedEndpoint: "cloud-endpoint", selectedModelId: "gpt-cloud", reason: "test", fitnessScore: 1,
    fallbackChain: ["local-endpoint"],
    candidates: [
      { endpointId: "cloud-endpoint", providerId: "openai", modelId: "gpt-cloud", endpointName: "Cloud",
        fitnessScore: 1, dimensionScores: {}, costPerOutputMToken: null, excluded: false },
      { endpointId: "local-endpoint", providerId: "local", modelId: "qwen3-coder", endpointName: "Local",
        fitnessScore: 0.8, dimensionScores: {}, costPerOutputMToken: null, excluded: false },
    ],
    excludedCount: 0, excludedReasons: [], policyRulesApplied: [], taskType: "build-review",
    sensitivity: "internal" as SensitivityLevel, timestamp: new Date(),
  };
}

beforeEach(() => {
  vi.useFakeTimers();
  vi.clearAllMocks();
  vi.mocked(prisma.modelProvider.findUnique).mockResolvedValue({ providerId: "openai", name: "Cloud" } as never);
});
afterEach(() => vi.useRealTimers());

describe("an agent's own budget refusal is not a provider failure (BI-F3B6713F)", () => {
  const refusal = () => new AgentBudgetExhaustedError("change-reviewer", 214_206, 200_000, "2026-11-05T00:00:00.000Z", "openai");

  it("moves on without disabling, degrading or cooling down the provider", async () => {
    mockCallProvider.mockReset()
      .mockRejectedValueOnce(refusal())
      .mockResolvedValueOnce({ content: "reviewed", inputTokens: 4, outputTokens: 2, inferenceMs: 20 } as never);
    const pending = callWithFallbackChain(decision(), [{ role: "user", content: "review" }], "system");
    await vi.runAllTimersAsync();
    await expect(pending).resolves.toMatchObject({ providerId: "local", content: "reviewed" });
    expect(autoDisableProvider).not.toHaveBeenCalled();
    expect(markEndpointUnavailable).not.toHaveBeenCalled();
    expect(prisma.modelProfile.updateMany).not.toHaveBeenCalled();
  });

  it("keeps the typed refusal as the cause when no endpoint could serve the call", async () => {
    const budget = refusal();
    mockCallProvider.mockReset()
      .mockRejectedValueOnce(budget)
      .mockRejectedValueOnce(new Error("local transport unavailable"));
    const pending = callWithFallbackChain(decision(), [{ role: "user", content: "review" }], "system")
      .catch((error: unknown) => error);
    await vi.runAllTimersAsync();
    const error = await pending;
    expect(error).toMatchObject({ cause: budget });
    expect((error as Error).message).toContain("agent-budget");
  });
});
