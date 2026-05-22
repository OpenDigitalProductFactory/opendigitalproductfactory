/**
 * EP-INF-004: Fallback behavior tests — model-level degradation, auto-recovery,
 * rate tracking in the callWithFallbackChain dispatch loop.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// ── Mocks (must be declared before imports) ──────────────────────────────────

vi.mock("@dpf/db", () => ({
  prisma: {
    modelProvider: {
      findUnique: vi.fn(),
      update: vi.fn(),
    },
    modelProfile: {
      updateMany: vi.fn(),
    },
  },
}));

vi.mock("@/lib/ai-inference", () => {
  class InferenceError extends Error {
    name = "InferenceError";
    constructor(
      message: string,
      public readonly code: string,
      public readonly providerId: string,
      public readonly statusCode?: number,
      public readonly headers?: Record<string, string>,
    ) {
      super(message);
    }
  }
  return {
    callProvider: vi.fn(),
    InferenceError,
  };
});

vi.mock("./rate-tracker", () => ({
  recordRequest: vi.fn(),
  learnFromRateLimitResponse: vi.fn(),
  extractRetryAfterMs: vi.fn(),
}));

vi.mock("./rate-recovery", () => ({
  scheduleRecovery: vi.fn(),
}));

vi.mock("@/lib/ai-provider-internals", () => ({
  autoDiscoverAndProfile: vi.fn(),
}));

vi.mock("./route-outcome", () => ({
  recordRouteOutcome: vi.fn(() => Promise.resolve()),
}));

// ── Imports (after mocks) ────────────────────────────────────────────────────

import { callWithFallbackChain } from "./fallback";
import { prisma } from "@dpf/db";
import { callProvider, InferenceError } from "@/lib/ai-inference";
import { recordRequest, learnFromRateLimitResponse, extractRetryAfterMs } from "./rate-tracker";
import { scheduleRecovery } from "./rate-recovery";
import { autoDiscoverAndProfile } from "@/lib/ai-provider-internals";
import { recordRouteOutcome } from "./route-outcome";
import type { RouteDecision } from "./types";
import type { SensitivityLevel } from "./types";

// ── Helpers ──────────────────────────────────────────────────────────────────

const makeDecision = (providerId: string, modelId: string): RouteDecision => ({
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
  sensitivity: "internal" as SensitivityLevel,
  timestamp: new Date(),
});

const mockPrisma = prisma as unknown as {
  modelProvider: {
    findUnique: ReturnType<typeof vi.fn>;
    update: ReturnType<typeof vi.fn>;
  };
  modelProfile: {
    updateMany: ReturnType<typeof vi.fn>;
  };
};

const mockCallProvider = callProvider as ReturnType<typeof vi.fn>;
const mockRecordRequest = recordRequest as ReturnType<typeof vi.fn>;
const mockLearnFromRateLimitResponse = learnFromRateLimitResponse as ReturnType<typeof vi.fn>;
const mockExtractRetryAfterMs = extractRetryAfterMs as ReturnType<typeof vi.fn>;
const mockScheduleRecovery = scheduleRecovery as ReturnType<typeof vi.fn>;
const mockAutoDiscoverAndProfile = autoDiscoverAndProfile as ReturnType<typeof vi.fn>;
const mockRecordRouteOutcome = recordRouteOutcome as ReturnType<typeof vi.fn>;

// ── Setup ────────────────────────────────────────────────────────────────────

beforeEach(() => {
  vi.useFakeTimers();
  vi.clearAllMocks();

  // Default: provider lookup returns a valid provider
  mockPrisma.modelProvider.findUnique.mockResolvedValue({
    providerId: "test-provider",
    name: "Test Provider",
  });

  // Default: prisma writes succeed
  mockPrisma.modelProfile.updateMany.mockResolvedValue({ count: 1 });
  mockPrisma.modelProvider.update.mockResolvedValue({});
  mockAutoDiscoverAndProfile.mockResolvedValue({
    discovered: 1,
    profiled: 1,
  });
  mockRecordRouteOutcome.mockResolvedValue(undefined);

  // Default: extractRetryAfterMs returns undefined (fallback to 60s)
  mockExtractRetryAfterMs.mockReturnValue(undefined);
});

afterEach(() => {
  vi.useRealTimers();
});

// ── Tests ────────────────────────────────────────────────────────────────────

describe("callWithFallbackChain — EP-INF-004 error handling", () => {
  // ── Success path ─────────────────────────────────────────────────────────

  describe("successful call", () => {
    it("records request with token count on success", async () => {
      mockCallProvider.mockResolvedValue({
        content: "hello",
        inputTokens: 100,
        outputTokens: 50,
        inferenceMs: 200,
      });

      await callWithFallbackChain(
        makeDecision("prov1", "model1"),
        [{ role: "user", content: "hi" }],
        "system",
      );

      expect(mockRecordRequest).toHaveBeenCalledWith("prov1", "model1", 150);
    });

    it("records route outcomes with coworker attribution from the MCP session", async () => {
      mockCallProvider.mockResolvedValue({
        content: "hello",
        inputTokens: 100,
        outputTokens: 50,
        inferenceMs: 200,
      });

      await callWithFallbackChain(
        makeDecision("prov1", "model1"),
        [{ role: "user", content: "hi" }],
        "system",
        undefined,
        undefined,
        undefined,
        { userId: "user-1", agentId: "support-specialist", threadId: "thread-1", routeContext: "service-operations" },
      );

      expect(mockRecordRouteOutcome).toHaveBeenCalledWith(
        expect.objectContaining({
          agentId: "support-specialist",
          providerId: "prov1",
          modelId: "model1",
          fallbackOccurred: false,
        }),
      );
    });
  });

  // ── 429 rate_limit ───────────────────────────────────────────────────────

  describe("rate_limit (429)", () => {
    const rateLimitHeaders = { "retry-after": "30" };

    function throwRateLimit() {
      const err = new InferenceError(
        "Rate limited",
        "rate_limit",
        "prov1",
        429,
        rateLimitHeaders,
      );
      mockCallProvider.mockRejectedValue(err);
    }

    it("triggers model-level degradation, NOT provider-level", async () => {
      throwRateLimit();

      const pending = callWithFallbackChain(
        makeDecision("prov1", "model1"),
        [{ role: "user", content: "hi" }],
        "system",
      );
      const rejection = expect(pending).rejects.toThrow();
      await vi.runAllTimersAsync();
      await rejection;

      // Model degraded at profile level
      expect(mockPrisma.modelProfile.updateMany).toHaveBeenCalledWith({
        where: { providerId: "prov1", modelId: "model1" },
        data: { modelStatus: "degraded" },
      });

      // Provider NOT updated
      expect(mockPrisma.modelProvider.update).not.toHaveBeenCalled();
    });

    it("triggers scheduleRecovery with providerId and modelId", async () => {
      throwRateLimit();
      mockExtractRetryAfterMs.mockReturnValue(30_000);

      const pending = callWithFallbackChain(
        makeDecision("prov1", "model1"),
        [{ role: "user", content: "hi" }],
        "system",
      );
      const rejection = expect(pending).rejects.toThrow();
      await vi.runAllTimersAsync();
      await rejection;

      expect(mockScheduleRecovery).toHaveBeenCalledWith("prov1", "model1");
    });

    it("defaults recovery delay to 60s when no retry-after header", async () => {
      throwRateLimit();
      mockExtractRetryAfterMs.mockReturnValue(undefined);

      const pending = callWithFallbackChain(
        makeDecision("prov1", "model1"),
        [{ role: "user", content: "hi" }],
        "system",
      );
      const rejection = expect(pending).rejects.toThrow();
      await vi.runAllTimersAsync();
      await rejection;

      expect(mockScheduleRecovery).toHaveBeenCalledWith("prov1", "model1");
    });

    it("calls recordRequest and learnFromRateLimitResponse", async () => {
      throwRateLimit();

      const pending = callWithFallbackChain(
        makeDecision("prov1", "model1"),
        [{ role: "user", content: "hi" }],
        "system",
      );
      const rejection = expect(pending).rejects.toThrow();
      await vi.runAllTimersAsync();
      await rejection;

      expect(mockRecordRequest).toHaveBeenCalledWith("prov1", "model1");
      expect(mockLearnFromRateLimitResponse).toHaveBeenCalledWith(
        "prov1",
        "model1",
        rateLimitHeaders,
      );
    });
  });

  // ── model_not_found ──────────────────────────────────────────────────────

  describe("model_not_found", () => {
    function throwModelNotFound() {
      const err = new InferenceError(
        "Model not found",
        "model_not_found",
        "prov1",
        404,
      );
      mockCallProvider.mockRejectedValue(err);
    }

    it("retires the specific model with status, timestamp, and reason", async () => {
      throwModelNotFound();

      await expect(
        callWithFallbackChain(
          makeDecision("prov1", "model1"),
          [{ role: "user", content: "hi" }],
          "system",
        ),
      ).rejects.toThrow();

      expect(mockPrisma.modelProfile.updateMany).toHaveBeenCalledWith({
        where: { providerId: "prov1", modelId: "model1" },
        data: {
          modelStatus: "retired",
          retiredAt: expect.any(Date),
          retiredReason: "model_not_found from provider",
        },
      });
    });

    it("does NOT change provider status", async () => {
      throwModelNotFound();

      await expect(
        callWithFallbackChain(
          makeDecision("prov1", "model1"),
          [{ role: "user", content: "hi" }],
          "system",
        ),
      ).rejects.toThrow();

      expect(mockPrisma.modelProvider.update).not.toHaveBeenCalled();
    });

    it("triggers provider reconciliation after retirement", async () => {
      throwModelNotFound();

      await expect(
        callWithFallbackChain(
          makeDecision("prov1", "model1"),
          [{ role: "user", content: "hi" }],
          "system",
        ),
      ).rejects.toThrow();

      expect(mockAutoDiscoverAndProfile).toHaveBeenCalledWith("prov1");
    });
  });

  // ── auth error ───────────────────────────────────────────────────────────

  describe("auth error", () => {
    function throwAuth() {
      const err = new InferenceError(
        "Invalid API key",
        "auth",
        "prov1",
        401,
      );
      mockCallProvider.mockRejectedValue(err);
    }

    it("disables the entire provider", async () => {
      throwAuth();

      await expect(
        callWithFallbackChain(
          makeDecision("prov1", "model1"),
          [{ role: "user", content: "hi" }],
          "system",
        ),
      ).rejects.toThrow();

      expect(mockPrisma.modelProvider.update).toHaveBeenCalledWith({
        where: { providerId: "prov1" },
        data: { status: "disabled" },
      });
    });

    it("does NOT change model status", async () => {
      throwAuth();

      await expect(
        callWithFallbackChain(
          makeDecision("prov1", "model1"),
          [{ role: "user", content: "hi" }],
          "system",
        ),
      ).rejects.toThrow();

      expect(mockPrisma.modelProfile.updateMany).not.toHaveBeenCalled();
    });
  });

  describe("provider interface drift", () => {
    it("degrades the model and triggers reconciliation after unsupported parameter errors", async () => {
      const err = new InferenceError(
        "HTTP 400 from prov1: Unsupported parameter: reasoning_effort",
        "provider_error",
        "prov1",
        400,
      );
      mockCallProvider.mockRejectedValue(err);

      await expect(
        callWithFallbackChain(
          makeDecision("prov1", "model1"),
          [{ role: "user", content: "hi" }],
          "system",
        ),
      ).rejects.toThrow();

      expect(mockPrisma.modelProfile.updateMany).toHaveBeenCalledWith({
        where: { providerId: "prov1", modelId: "model1" },
        data: { modelStatus: "degraded" },
      });
      expect(mockAutoDiscoverAndProfile).toHaveBeenCalledWith("prov1");
      expect(mockPrisma.modelProvider.update).not.toHaveBeenCalled();
    });
  });

  // ── transient (5xx / 408) ──────────────────────────────────────────────────

  describe("transient errors (500/502/503/504/408)", () => {
    it("retries the pinned endpoint once after 10 s on transient error then succeeds", async () => {
      const transientErr = new InferenceError("Transient error (500) from prov1", "transient", "prov1", 500);
      mockCallProvider
        .mockRejectedValueOnce(transientErr)
        .mockResolvedValueOnce({ content: "ok", inputTokens: 10, outputTokens: 5, inferenceMs: 100 });

      const pending = callWithFallbackChain(
        makeDecision("prov1", "model1"),
        [{ role: "user", content: "hi" }],
        "system",
      );
      await vi.advanceTimersByTimeAsync(10_000);
      const result = await pending;

      expect(result.content).toBe("ok");
      expect(mockCallProvider).toHaveBeenCalledTimes(2);
      expect(mockPrisma.modelProfile.updateMany).not.toHaveBeenCalled();
    });

    it("degrades model and schedules recovery after transient retry also fails", async () => {
      const err = new InferenceError("Transient error (503) from prov1", "transient", "prov1", 503);
      mockCallProvider.mockRejectedValue(err);

      const pending = callWithFallbackChain(
        makeDecision("prov1", "model1"),
        [{ role: "user", content: "hi" }],
        "system",
      );
      const rejection = expect(pending).rejects.toThrow("All endpoints failed");
      await vi.runAllTimersAsync();
      await rejection;

      expect(mockPrisma.modelProfile.updateMany).toHaveBeenCalledWith({
        where: { providerId: "prov1", modelId: "model1" },
        data: { modelStatus: "degraded" },
      });
      expect(mockScheduleRecovery).toHaveBeenCalledWith("prov1", "model1");
      expect(mockPrisma.modelProvider.update).not.toHaveBeenCalled();
    });

    it("does not retry transient on a fallback endpoint", async () => {
      const decision: RouteDecision = {
        selectedEndpoint: "prov1",
        selectedModelId: "model1",
        reason: "test",
        fitnessScore: 1,
        fallbackChain: ["fallback-prov"],
        candidates: [
          { endpointId: "prov1", providerId: "prov1", modelId: "model1",
            endpointName: "Prov1", fitnessScore: 1, dimensionScores: {},
            costPerOutputMToken: null, excluded: false },
          { endpointId: "fallback-prov", providerId: "fallback-prov", modelId: "fb-model",
            endpointName: "Fallback", fitnessScore: 0.5, dimensionScores: {},
            costPerOutputMToken: null, excluded: false },
        ],
        excludedCount: 0, excludedReasons: [], policyRulesApplied: [],
        taskType: "test", sensitivity: "internal" as SensitivityLevel, timestamp: new Date(),
      };

      mockPrisma.modelProvider.findUnique
        .mockResolvedValueOnce({ providerId: "prov1", name: "Prov1" })
        .mockResolvedValueOnce({ providerId: "fallback-prov", name: "Fallback" });

      const pinnedErr = new InferenceError("pinned rate limit", "rate_limit", "prov1", 429);
      const fallbackTransient = new InferenceError("Transient 502 from fallback", "transient", "fallback-prov", 502);
      // pinned: rate_limit → retry (30s wait) → rate_limit → degrade → fallback: transient (no retry)
      mockCallProvider
        .mockRejectedValueOnce(pinnedErr)
        .mockRejectedValueOnce(pinnedErr)
        .mockRejectedValueOnce(fallbackTransient);

      const pending = callWithFallbackChain(
        decision,
        [{ role: "user", content: "hi" }],
        "system",
      );
      const rejection = expect(pending).rejects.toThrow("All endpoints failed");
      await vi.runAllTimersAsync();
      await rejection;

      // pinned×2 (rate limit + retry) + fallback×1 (no transient retry)
      expect(mockCallProvider).toHaveBeenCalledTimes(3);
    });
  });

  // ── billing (402) ──────────────────────────────────────────────────────────

  describe("billing error (402)", () => {
    function throwBilling() {
      const err = new InferenceError("Billing error on prov1", "billing", "prov1", 402);
      mockCallProvider.mockRejectedValue(err);
    }

    it("disables the entire provider", async () => {
      throwBilling();

      await expect(
        callWithFallbackChain(
          makeDecision("prov1", "model1"),
          [{ role: "user", content: "hi" }],
          "system",
        ),
      ).rejects.toThrow();

      expect(mockPrisma.modelProvider.update).toHaveBeenCalledWith({
        where: { providerId: "prov1" },
        data: { status: "disabled" },
      });
    });

    it("does not degrade the model", async () => {
      throwBilling();

      await expect(
        callWithFallbackChain(
          makeDecision("prov1", "model1"),
          [{ role: "user", content: "hi" }],
          "system",
        ),
      ).rejects.toThrow();

      expect(mockPrisma.modelProfile.updateMany).not.toHaveBeenCalled();
    });
  });

  // ── request_too_large (413) ────────────────────────────────────────────────

  describe("request_too_large (413)", () => {
    it("throws immediately without trying fallback endpoints", async () => {
      const err = new InferenceError("Request too large for prov1", "request_too_large", "prov1", 413);
      mockCallProvider.mockRejectedValueOnce(err);

      const decision: RouteDecision = {
        selectedEndpoint: "prov1",
        selectedModelId: "model1",
        reason: "test",
        fitnessScore: 1,
        fallbackChain: ["fallback-prov"],
        candidates: [
          { endpointId: "prov1", providerId: "prov1", modelId: "model1",
            endpointName: "Prov1", fitnessScore: 1, dimensionScores: {},
            costPerOutputMToken: null, excluded: false },
          { endpointId: "fallback-prov", providerId: "fallback-prov", modelId: "fb-model",
            endpointName: "Fallback", fitnessScore: 0.5, dimensionScores: {},
            costPerOutputMToken: null, excluded: false },
        ],
        excludedCount: 0, excludedReasons: [], policyRulesApplied: [],
        taskType: "test", sensitivity: "internal" as SensitivityLevel, timestamp: new Date(),
      };

      await expect(
        callWithFallbackChain(
          decision,
          [{ role: "user", content: "hi" }],
          "system",
        ),
      ).rejects.toThrow("REQUEST_TOO_LARGE");

      expect(mockCallProvider).toHaveBeenCalledTimes(1);
    });
  });

  // ── provider overload (529) ────────────────────────────────────────────────

  describe("provider overload (529)", () => {
    it("degrades model and schedules recovery without disabling provider when retry also fails", async () => {
      const err = new InferenceError("Provider overloaded on prov1", "overloaded", "prov1", 529);
      mockCallProvider.mockRejectedValue(err);

      const pending = callWithFallbackChain(
        makeDecision("prov1", "model1"),
        [{ role: "user", content: "hi" }],
        "system",
      );
      const rejection = expect(pending).rejects.toThrow("All endpoints failed");
      await vi.runAllTimersAsync();
      await rejection;

      expect(mockPrisma.modelProfile.updateMany).toHaveBeenCalledWith({
        where: { providerId: "prov1", modelId: "model1" },
        data: { modelStatus: "degraded" },
      });
      expect(mockScheduleRecovery).toHaveBeenCalledWith("prov1", "model1");
      expect(mockPrisma.modelProvider.update).not.toHaveBeenCalled();
    });

    it("retries the pinned endpoint once after 15 s on overload then succeeds", async () => {
      const overloadErr = new InferenceError("Provider overloaded on prov1", "overloaded", "prov1", 529);
      mockCallProvider
        .mockRejectedValueOnce(overloadErr)
        .mockResolvedValueOnce({ content: "ok after retry", inputTokens: 10, outputTokens: 5, inferenceMs: 100 });

      const pending = callWithFallbackChain(
        makeDecision("prov1", "model1"),
        [{ role: "user", content: "hi" }],
        "system",
      );
      await vi.advanceTimersByTimeAsync(15_000);
      const result = await pending;

      expect(result.content).toBe("ok after retry");
      expect(mockCallProvider).toHaveBeenCalledTimes(2);
      expect(mockPrisma.modelProfile.updateMany).not.toHaveBeenCalled();
    });

    it("does not retry overload on a fallback (non-pinned) endpoint", async () => {
      const decision: RouteDecision = {
        selectedEndpoint: "prov1",
        selectedModelId: "model1",
        reason: "test",
        fitnessScore: 1,
        fallbackChain: ["fallback-prov"],
        candidates: [
          { endpointId: "prov1", providerId: "prov1", modelId: "model1",
            endpointName: "Prov1", fitnessScore: 1, dimensionScores: {},
            costPerOutputMToken: null, excluded: false },
          { endpointId: "fallback-prov", providerId: "fallback-prov", modelId: "fb-model",
            endpointName: "Fallback", fitnessScore: 0.5, dimensionScores: {},
            costPerOutputMToken: null, excluded: false },
        ],
        excludedCount: 0, excludedReasons: [], policyRulesApplied: [],
        taskType: "test", sensitivity: "internal" as SensitivityLevel, timestamp: new Date(),
      };

      mockPrisma.modelProvider.findUnique
        .mockResolvedValueOnce({ providerId: "prov1", name: "Prov1" })
        .mockResolvedValueOnce({ providerId: "fallback-prov", name: "Fallback" });

      const pinnedErr = new InferenceError("pinned auth fail", "auth", "prov1", 401);
      const overloadErr = new InferenceError("Provider overloaded on fallback", "overloaded", "fallback-prov", 529);
      mockCallProvider
        .mockRejectedValueOnce(pinnedErr)
        .mockRejectedValueOnce(overloadErr);

      const pending = callWithFallbackChain(
        decision,
        [{ role: "user", content: "hi" }],
        "system",
      );
      const rejection = expect(pending).rejects.toThrow("All endpoints failed");
      await vi.runAllTimersAsync();
      await rejection;

      expect(mockCallProvider).toHaveBeenCalledTimes(2);
    });
  });

  // ── local fallback skip on large tool surfaces (FB-71FB3A53) ────────────────

  describe("local fallback skip on large tool surfaces", () => {
    function makeChainWithLocalFallback(): RouteDecision {
      return {
        selectedEndpoint: "prov1",
        selectedModelId: "model1",
        reason: "test",
        fitnessScore: 1,
        fallbackChain: ["local"],
        candidates: [
          { endpointId: "prov1", providerId: "prov1", modelId: "model1",
            endpointName: "Prov1", fitnessScore: 1, dimensionScores: {},
            costPerOutputMToken: null, excluded: false },
          { endpointId: "local", providerId: "local", modelId: "local-7b",
            endpointName: "Local", fitnessScore: 0.5, dimensionScores: {},
            costPerOutputMToken: null, excluded: false },
        ],
        excludedCount: 0, excludedReasons: [], policyRulesApplied: [],
        taskType: "test", sensitivity: "internal" as SensitivityLevel, timestamp: new Date(),
      };
    }

    function manyTools(count: number): Array<Record<string, unknown>> {
      return Array.from({ length: count }, (_, i) => ({
        name: `tool_${i}`,
        description: `Tool ${i}`,
        parameters: { type: "object", properties: {} },
      }));
    }

    it("skips local fallback when tools.length exceeds threshold", async () => {
      mockPrisma.modelProvider.findUnique
        .mockResolvedValueOnce({ providerId: "prov1", name: "Prov1" });

      const pinnedErr = new InferenceError("preferred down", "auth", "prov1", 401);
      mockCallProvider.mockRejectedValueOnce(pinnedErr);

      const pending = callWithFallbackChain(
        makeChainWithLocalFallback(),
        [{ role: "user", content: "hi" }],
        "system",
        manyTools(30), // build-studio-shaped tool surface
      );
      const rejection = expect(pending).rejects.toThrow("All endpoints failed");
      await vi.runAllTimersAsync();
      await rejection;

      // Only the primary was attempted; local fallback was skipped.
      expect(mockCallProvider).toHaveBeenCalledTimes(1);
    });

    it("keeps local fallback when tools.length is within threshold", async () => {
      mockPrisma.modelProvider.findUnique
        .mockResolvedValueOnce({ providerId: "prov1", name: "Prov1" })
        .mockResolvedValueOnce({ providerId: "local", name: "Local" });

      const pinnedErr = new InferenceError("preferred down", "auth", "prov1", 401);
      const localErr = new InferenceError("local also down", "auth", "local", 401);
      mockCallProvider
        .mockRejectedValueOnce(pinnedErr)
        .mockRejectedValueOnce(localErr);

      const pending = callWithFallbackChain(
        makeChainWithLocalFallback(),
        [{ role: "user", content: "hi" }],
        "system",
        manyTools(10), // small tool surface — local should still be tried
      );
      const rejection = expect(pending).rejects.toThrow("All endpoints failed");
      await vi.runAllTimersAsync();
      await rejection;

      // Primary + local fallback both attempted.
      expect(mockCallProvider).toHaveBeenCalledTimes(2);
    });

    it("keeps local fallback when no tools are passed at all", async () => {
      mockPrisma.modelProvider.findUnique
        .mockResolvedValueOnce({ providerId: "prov1", name: "Prov1" })
        .mockResolvedValueOnce({ providerId: "local", name: "Local" });

      const pinnedErr = new InferenceError("preferred down", "auth", "prov1", 401);
      const localErr = new InferenceError("local also down", "auth", "local", 401);
      mockCallProvider
        .mockRejectedValueOnce(pinnedErr)
        .mockRejectedValueOnce(localErr);

      const pending = callWithFallbackChain(
        makeChainWithLocalFallback(),
        [{ role: "user", content: "hi" }],
        "system",
      );
      const rejection = expect(pending).rejects.toThrow("All endpoints failed");
      await vi.runAllTimersAsync();
      await rejection;

      expect(mockCallProvider).toHaveBeenCalledTimes(2);
    });

    it("still attempts the local primary endpoint even on large tool surfaces", async () => {
      // If routing decided local IS the primary (e.g. local_only residency),
      // the skip-on-fallback guard should NOT block i=0.
      const decision: RouteDecision = {
        selectedEndpoint: "local",
        selectedModelId: "local-7b",
        reason: "test",
        fitnessScore: 1,
        fallbackChain: [],
        candidates: [
          { endpointId: "local", providerId: "local", modelId: "local-7b",
            endpointName: "Local", fitnessScore: 1, dimensionScores: {},
            costPerOutputMToken: null, excluded: false },
        ],
        excludedCount: 0, excludedReasons: [], policyRulesApplied: [],
        taskType: "test", sensitivity: "internal" as SensitivityLevel, timestamp: new Date(),
      };

      mockPrisma.modelProvider.findUnique.mockResolvedValueOnce({ providerId: "local", name: "Local" });
      mockCallProvider.mockResolvedValueOnce({
        content: "ok",
        inputTokens: 10,
        outputTokens: 5,
        inferenceMs: 100,
      });

      const result = await callWithFallbackChain(
        decision,
        [{ role: "user", content: "hi" }],
        "system",
        manyTools(30),
      );

      expect(result.content).toBe("ok");
      expect(mockCallProvider).toHaveBeenCalledTimes(1);
    });
  });
});
