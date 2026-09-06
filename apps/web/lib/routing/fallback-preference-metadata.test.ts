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
