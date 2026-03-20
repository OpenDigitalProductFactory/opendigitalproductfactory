/**
 * EP-INF-004: Fallback behavior tests — model-level degradation, auto-recovery,
 * rate tracking in the callWithFallbackChain dispatch loop.
 */
import { describe, expect, it, beforeEach, vi } from "vitest";

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

// ── Imports (after mocks) ────────────────────────────────────────────────────

import { callWithFallbackChain } from "./fallback";
import { prisma } from "@dpf/db";
import { callProvider, InferenceError } from "@/lib/ai-inference";
import { recordRequest, learnFromRateLimitResponse, extractRetryAfterMs } from "./rate-tracker";
import { scheduleRecovery } from "./rate-recovery";
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

// ── Setup ────────────────────────────────────────────────────────────────────

beforeEach(() => {
  vi.clearAllMocks();

  // Default: provider lookup returns a valid provider
  mockPrisma.modelProvider.findUnique.mockResolvedValue({
    providerId: "test-provider",
    name: "Test Provider",
  });

  // Default: prisma writes succeed
  mockPrisma.modelProfile.updateMany.mockResolvedValue({ count: 1 });
  mockPrisma.modelProvider.update.mockResolvedValue({});

  // Default: extractRetryAfterMs returns undefined (fallback to 60s)
  mockExtractRetryAfterMs.mockReturnValue(undefined);
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

      await expect(
        callWithFallbackChain(
          makeDecision("prov1", "model1"),
          [{ role: "user", content: "hi" }],
          "system",
        ),
      ).rejects.toThrow();

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

      await expect(
        callWithFallbackChain(
          makeDecision("prov1", "model1"),
          [{ role: "user", content: "hi" }],
          "system",
        ),
      ).rejects.toThrow();

      expect(mockScheduleRecovery).toHaveBeenCalledWith("prov1", "model1", 30_000);
    });

    it("defaults recovery delay to 60s when no retry-after header", async () => {
      throwRateLimit();
      mockExtractRetryAfterMs.mockReturnValue(undefined);

      await expect(
        callWithFallbackChain(
          makeDecision("prov1", "model1"),
          [{ role: "user", content: "hi" }],
          "system",
        ),
      ).rejects.toThrow();

      expect(mockScheduleRecovery).toHaveBeenCalledWith("prov1", "model1", 60_000);
    });

    it("calls recordRequest and learnFromRateLimitResponse", async () => {
      throwRateLimit();

      await expect(
        callWithFallbackChain(
          makeDecision("prov1", "model1"),
          [{ role: "user", content: "hi" }],
          "system",
        ),
      ).rejects.toThrow();

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
});
