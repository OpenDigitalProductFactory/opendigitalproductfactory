/**
 * EP-INF-006: Route outcome recording tests (TDD).
 */

import { describe, expect, it, vi, beforeEach } from "vitest";

vi.mock("@dpf/db", () => ({
  prisma: {
    routeOutcome: {
      create: vi.fn(),
    },
  },
}));

vi.mock("./recipe-performance", () => ({
  updateRecipePerformance: vi.fn(),
}));

vi.mock("./reward", () => ({
  computeReward: vi.fn(() => 0.75),
}));

import { prisma } from "@dpf/db";
import { recordRouteOutcome, type RouteOutcomeInput } from "./route-outcome";
import { updateRecipePerformance } from "./recipe-performance";
import { computeReward } from "./reward";

// ── Fixtures ─────────────────────────────────────────────────────────────────

const BASE_OUTCOME: RouteOutcomeInput = {
  providerId: "openai",
  modelId: "gpt-4o",
  recipeId: null,
  contractFamily: "sync.code-gen",
  taskType: "code-gen",
  latencyMs: 1200,
  inputTokens: 500,
  outputTokens: 200,
  costUsd: 0.02,
  schemaValid: true,
  toolSuccess: null,
  fallbackOccurred: false,
};

// ── Tests ────────────────────────────────────────────────────────────────────

describe("recordRouteOutcome", () => {
  beforeEach(() => {
    vi.mocked(prisma.routeOutcome.create).mockReset();
    vi.mocked(prisma.routeOutcome.create).mockResolvedValue({} as any);
    vi.mocked(updateRecipePerformance).mockReset();
    vi.mocked(updateRecipePerformance).mockResolvedValue(undefined);
    vi.mocked(computeReward).mockReset();
    vi.mocked(computeReward).mockReturnValue(0.75);
  });

  it("records outcome with all fields", async () => {
    await recordRouteOutcome(BASE_OUTCOME);

    expect(prisma.routeOutcome.create).toHaveBeenCalledOnce();
    const call = vi.mocked(prisma.routeOutcome.create).mock.calls[0][0];
    expect(call.data).toMatchObject({
      providerId: "openai",
      modelId: "gpt-4o",
      recipeId: null,
      contractFamily: "sync.code-gen",
      taskType: "code-gen",
      latencyMs: 1200,
      inputTokens: 500,
      outputTokens: 200,
      costUsd: 0.02,
      schemaValid: true,
      toolSuccess: null,
      fallbackOccurred: false,
    });
  });

  it("generates unique requestId", async () => {
    await recordRouteOutcome(BASE_OUTCOME);
    await recordRouteOutcome(BASE_OUTCOME);

    const calls = vi.mocked(prisma.routeOutcome.create).mock.calls;
    const id1 = calls[0][0].data.requestId;
    const id2 = calls[1][0].data.requestId;

    expect(id1).toBeDefined();
    expect(id2).toBeDefined();
    expect(id1).not.toBe(id2);
  });

  it("calls updateRecipePerformance when recipeId is set", async () => {
    const outcome: RouteOutcomeInput = {
      ...BASE_OUTCOME,
      recipeId: "recipe-42",
    };

    await recordRouteOutcome(outcome);

    expect(computeReward).toHaveBeenCalledOnce();
    expect(updateRecipePerformance).toHaveBeenCalledOnce();
    expect(updateRecipePerformance).toHaveBeenCalledWith(
      "recipe-42",
      "sync.code-gen",
      expect.objectContaining({
        latencyMs: 1200,
        costUsd: 0.02,
        reward: 0.75,
        schemaValid: true,
        toolSuccess: null,
        isSuccess: true,
      }),
    );
  });

  it("does NOT call updateRecipePerformance when recipeId is null", async () => {
    await recordRouteOutcome(BASE_OUTCOME);

    expect(updateRecipePerformance).not.toHaveBeenCalled();
    expect(computeReward).not.toHaveBeenCalled();
  });

  it("catches DB errors without throwing", async () => {
    vi.mocked(prisma.routeOutcome.create).mockRejectedValue(
      new Error("DB connection lost"),
    );

    // Should not throw
    await expect(recordRouteOutcome(BASE_OUTCOME)).resolves.toBeUndefined();
  });

  it("sets isSuccess false when providerErrorCode is present", async () => {
    const outcome: RouteOutcomeInput = {
      ...BASE_OUTCOME,
      recipeId: "recipe-42",
      providerErrorCode: "rate_limit",
    };

    await recordRouteOutcome(outcome);

    expect(updateRecipePerformance).toHaveBeenCalledWith(
      "recipe-42",
      "sync.code-gen",
      expect.objectContaining({
        isSuccess: false,
      }),
    );
  });
});
