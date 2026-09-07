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
import { LocalProviderCapacityDeferredError } from "./local-provider-capacity";
import type { RouteDecision, SensitivityLevel } from "./types";

const mockCallProvider = vi.mocked(callProvider);
const mockProviderLookup = vi.mocked(prisma.modelProvider.findUnique);

function decisionWithCloudFallback(): RouteDecision {
  return {
    selectedEndpoint: "local-endpoint",
    selectedModelId: "qwen3-coder",
    reason: "test",
    fitnessScore: 1,
    fallbackChain: ["cloud-endpoint"],
    candidates: [
      {
        endpointId: "local-endpoint", providerId: "local", modelId: "qwen3-coder",
        endpointName: "Local", fitnessScore: 1, dimensionScores: {},
        costPerOutputMToken: null, excluded: false,
      },
      {
        endpointId: "cloud-endpoint", providerId: "openai", modelId: "gpt-cloud",
        endpointName: "Cloud", fitnessScore: 0.8, dimensionScores: {},
        costPerOutputMToken: null, excluded: false,
      },
    ],
    excludedCount: 0,
    excludedReasons: [],
    policyRulesApplied: [],
    taskType: "sync.triage",
    sensitivity: "internal" as SensitivityLevel,
    timestamp: new Date(),
  };
}

beforeEach(() => {
  vi.useFakeTimers();
  vi.clearAllMocks();
  mockProviderLookup.mockResolvedValue({ providerId: "openai", name: "Cloud" } as never);
});

afterEach(() => vi.useRealTimers());

describe("fallback local-CI capacity arbitration", () => {
  it.each([
    "local-ci-active-capacity-reservation",
    "local-ci-queued-capacity-reservation",
    "local-ci-capacity-reservation-unavailable",
  ] as const)("retains %s as the cause alongside the failed cloud attempt", async (reason) => {
    const deferred = new LocalProviderCapacityDeferredError(reason);
    mockCallProvider
      .mockRejectedValueOnce(new Error("cloud transport unavailable"))
      .mockRejectedValueOnce(deferred);
    const decision = decisionWithCloudFallback();
    decision.selectedEndpoint = "cloud-endpoint";
    decision.selectedModelId = "gpt-cloud";
    decision.fallbackChain = ["local-endpoint"];

    const pending = callWithFallbackChain(
      decision, [{ role: "user", content: "review" }], "system",
    ).catch((error: unknown) => error);
    await vi.runAllTimersAsync();
    const error = await pending;
    expect(error).toMatchObject({ cause: deferred });
    expect((error as Error).message).toContain("cloud transport unavailable");
    expect((error as Error).message).toContain(reason);
    expect(mockCallProvider.mock.calls.map((call) => call.slice(0, 2))).toEqual([
      ["openai", "gpt-cloud"],
      ["local", "qwen3-coder"],
    ]);
  });

  it("returns the typed deferral for a local-only chain", async () => {
    mockCallProvider.mockRejectedValueOnce(
      new LocalProviderCapacityDeferredError("local-ci-active-capacity-reservation"),
    );
    const decision = decisionWithCloudFallback();
    decision.fallbackChain = [];
    decision.candidates = decision.candidates.slice(0, 1);

    await expect(
      callWithFallbackChain(decision, [{ role: "user", content: "triage" }], "system"),
    ).rejects.toMatchObject({
      name: "LocalProviderCapacityDeferredError",
      reason: "local-ci-active-capacity-reservation",
    });
  });

  it("continues from a capacity-deferred local route to a cloud fallback", async () => {
    mockCallProvider
      .mockRejectedValueOnce(
        new LocalProviderCapacityDeferredError("local-ci-active-capacity-reservation"),
      )
      .mockResolvedValueOnce({
        content: "triaged", inputTokens: 4, outputTokens: 2, inferenceMs: 20,
      } as never);

    const pending = callWithFallbackChain(
      decisionWithCloudFallback(),
      [{ role: "user", content: "triage" }],
      "system",
    );
    await vi.runAllTimersAsync();

    await expect(pending).resolves.toMatchObject({
      providerId: "openai",
      content: "triaged",
      downgraded: true,
    });
    expect(mockCallProvider.mock.calls[1]?.slice(0, 2)).toEqual(["openai", "gpt-cloud"]);
  });
});
