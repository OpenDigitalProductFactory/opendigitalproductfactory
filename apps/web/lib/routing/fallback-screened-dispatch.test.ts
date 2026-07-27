import { beforeEach, describe, expect, it, vi } from "vitest";
import type { RouteDecision } from "./types";

const mocks = vi.hoisted(() => ({
  callProvider: vi.fn(),
  findProvider: vi.fn(),
  updateProvider: vi.fn(),
  updateModels: vi.fn(),
  recordRouteOutcome: vi.fn(),
}));

vi.mock("@dpf/db", () => ({
  prisma: {
    modelProvider: {
      findUnique: mocks.findProvider,
      update: mocks.updateProvider,
    },
    modelProfile: {
      updateMany: mocks.updateModels,
    },
  },
}));

vi.mock("@/lib/ai-inference", () => {
  class InferenceError extends Error {
    constructor(
      message: string,
      public readonly code: string,
      public readonly providerId: string,
      public readonly statusCode?: number,
      public readonly headers?: Record<string, string>,
    ) {
      super(message);
      this.name = "InferenceError";
    }
  }
  return {
    callProvider: mocks.callProvider,
    InferenceError,
  };
});

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
vi.mock("@/lib/provider-oauth", () => ({ refreshOAuthToken: vi.fn() }));
vi.mock("./route-outcome", () => ({
  recordRouteOutcome: mocks.recordRouteOutcome,
}));

import { callWithFallbackChain } from "./fallback";

function makeCandidate(
  endpointId: string,
  providerId: string,
  modelId: string,
  overrides: Partial<RouteDecision["candidates"][number]> = {},
): RouteDecision["candidates"][number] {
  return {
    endpointId,
    providerId,
    modelId,
    endpointName: modelId,
    fitnessScore: 1,
    dimensionScores: {},
    costPerOutputMToken: null,
    excluded: false,
    ...overrides,
  };
}

function makeDecision(providerId: string, modelId: string): RouteDecision {
  return {
    selectedEndpoint: providerId,
    selectedModelId: modelId,
    reason: "test",
    fitnessScore: 1,
    fallbackChain: [],
    candidates: [],
    excludedCount: 0,
    excludedReasons: [],
    policyRulesApplied: [],
    taskType: "test",
    sensitivity: "internal",
    timestamp: new Date(),
  };
}

const localOnlyReceipt: NonNullable<RouteDecision["inferenceDataScreenReceipt"]> = {
  schemaVersion: "inference-data-screen/v1",
  screenId: "screen_local_only",
  decisionIds: ["decision-local-only"],
  inputHash: "hash-local-only",
  classifiedDataClasses: ["employee-records"],
  policyEffect: "deny",
  routeEffect: "local-only",
  destinationClass: "external-service",
  transformation: "blocked",
  explanationCodes: ["restricted-external-denied"],
  obligationKinds: [],
  rawPayloadStored: false,
};

const allowReceipt: NonNullable<RouteDecision["inferenceDataScreenReceipt"]> = {
  ...localOnlyReceipt,
  screenId: "screen_allow",
  decisionIds: ["decision-allow"],
  inputHash: "hash-allow",
  policyEffect: "allow",
  routeEffect: "allow",
  transformation: "none",
  explanationCodes: ["dispatch-allowed"],
};

beforeEach(() => {
  vi.clearAllMocks();
  mocks.callProvider.mockReset();
  mocks.findProvider.mockResolvedValue({
    providerId: "openai",
    name: "OpenAI",
    authMethod: "api_key",
  });
  mocks.updateProvider.mockResolvedValue({});
  mocks.updateModels.mockResolvedValue({ count: 1 });
  mocks.recordRouteOutcome.mockResolvedValue(undefined);
});

describe("screened fallback dispatch", () => {
  it("requires a data-screen receipt before governed inference dispatch", async () => {
    await expect(
      callWithFallbackChain(
        {
          ...makeDecision("prov1", "model1"),
          policyRulesApplied: ["inference-dispatch"],
        },
        [{ role: "user", content: "employee salary note" }],
        "system",
      ),
    ).rejects.toThrow("missing inference data screen receipt");

    expect(mocks.callProvider).not.toHaveBeenCalled();
  });

  it("does not dispatch a governed fallback excluded by the route decision", async () => {
    mocks.callProvider.mockRejectedValueOnce(new Error("primary unavailable"));

    const decision: RouteDecision = {
      ...makeDecision("openai-ep", "gpt-4.1"),
      selectedEndpoint: "openai-ep",
      selectedModelId: "gpt-4.1",
      fallbackChain: ["unsafe-public-ep"],
      policyRulesApplied: ["inference-dispatch"],
      inferenceDataScreenReceipt: allowReceipt,
      candidates: [
        makeCandidate("openai-ep", "openai", "gpt-4.1"),
        makeCandidate("unsafe-public-ep", "cheap-public", "cheap-model", {
          excluded: true,
          excludedReason: "sensitivityClearance excludes restricted data",
        }),
      ],
    };

    await expect(
      callWithFallbackChain(
        decision,
        [{ role: "user", content: "employee salary note" }],
        "system",
      ),
    ).rejects.toThrow("All endpoints failed");

    expect(mocks.callProvider).toHaveBeenCalledTimes(1);
    expect(mocks.callProvider).toHaveBeenCalledWith(
      "openai",
      "gpt-4.1",
      expect.any(Array),
      "system",
      undefined,
      expect.any(Object),
      undefined,
      undefined,
      expect.any(Object),
    );
  });

  it("does not dispatch a non-local candidate under a local-only receipt", async () => {
    const decision: RouteDecision = {
      ...makeDecision("cloud-ep", "cloud-model"),
      selectedEndpoint: "cloud-ep",
      selectedModelId: "cloud-model",
      policyRulesApplied: ["inference-dispatch"],
      inferenceDataScreenReceipt: localOnlyReceipt,
      candidates: [
        makeCandidate("cloud-ep", "cheap-public", "cloud-model"),
      ],
    };

    await expect(
      callWithFallbackChain(
        decision,
        [{ role: "user", content: "employee salary note" }],
        "system",
      ),
    ).rejects.toThrow("No eligible screened endpoint available");

    expect(mocks.callProvider).not.toHaveBeenCalled();
  });
});
