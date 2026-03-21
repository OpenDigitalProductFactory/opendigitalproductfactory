/**
 * EP-INF-006: Recipe performance aggregation tests (TDD).
 */

import { describe, expect, it, vi, beforeEach } from "vitest";

vi.mock("@dpf/db", () => ({
  prisma: {
    recipePerformance: {
      findUnique: vi.fn(),
      create: vi.fn(),
      update: vi.fn(),
    },
  },
}));

vi.mock("./champion-challenger", () => ({
  evaluatePromotions: vi.fn(() => Promise.resolve()),
}));

import { prisma } from "@dpf/db";
import { updateRecipePerformance, type PerformanceOutcome } from "./recipe-performance";
import { evaluatePromotions } from "./champion-challenger";

// ── Fixtures ─────────────────────────────────────────────────────────────────

const BASE_OUTCOME: PerformanceOutcome = {
  latencyMs: 1000,
  costUsd: 0.02,
  reward: 0.8,
  schemaValid: true,
  toolSuccess: null,
  isSuccess: true,
};

function makeExistingPerf(overrides: Record<string, unknown> = {}) {
  return {
    id: "perf-1",
    recipeId: "recipe-1",
    contractFamily: "sync.code-gen",
    sampleCount: 4,
    successCount: 3,
    avgLatencyMs: 1200,
    avgCostUsd: 0.03,
    avgGraderScore: null,
    avgHumanScore: null,
    avgSchemaValidRate: 0.75,
    avgToolSuccessRate: null,
    ewmaReward: 0.6,
    lastObservedAt: new Date(),
    ...overrides,
  };
}

// ── Tests ────────────────────────────────────────────────────────────────────

describe("updateRecipePerformance", () => {
  beforeEach(() => {
    vi.mocked(prisma.recipePerformance.findUnique).mockReset();
    vi.mocked(prisma.recipePerformance.create).mockReset();
    vi.mocked(prisma.recipePerformance.update).mockReset();
    vi.mocked(prisma.recipePerformance.create).mockResolvedValue({} as any);
    vi.mocked(prisma.recipePerformance.update).mockResolvedValue({} as any);
    vi.mocked(evaluatePromotions).mockReset();
    vi.mocked(evaluatePromotions).mockResolvedValue(undefined);
  });

  it("first observation initializes values correctly", async () => {
    vi.mocked(prisma.recipePerformance.findUnique).mockResolvedValue(null);

    await updateRecipePerformance("recipe-1", "sync.code-gen", BASE_OUTCOME);

    expect(prisma.recipePerformance.create).toHaveBeenCalledOnce();
    const data = vi.mocked(prisma.recipePerformance.create).mock.calls[0][0].data;
    expect(data).toMatchObject({
      recipeId: "recipe-1",
      contractFamily: "sync.code-gen",
      sampleCount: 1,
      successCount: 1,
      avgLatencyMs: 1000,
      avgCostUsd: 0.02,
      avgSchemaValidRate: 1, // schemaValid=true → 1
      avgToolSuccessRate: null, // toolSuccess=null → null
      ewmaReward: 0.8,
    });
  });

  it("incremental average after 5 observations", async () => {
    const existing = makeExistingPerf({ sampleCount: 4, avgLatencyMs: 1200, avgCostUsd: 0.03 });
    vi.mocked(prisma.recipePerformance.findUnique).mockResolvedValue(existing as any);

    await updateRecipePerformance("recipe-1", "sync.code-gen", {
      ...BASE_OUTCOME,
      latencyMs: 800,
      costUsd: 0.01,
    });

    expect(prisma.recipePerformance.update).toHaveBeenCalledOnce();
    const data = vi.mocked(prisma.recipePerformance.update).mock.calls[0][0].data;
    // newAvg = (1200*4 + 800) / 5 = 5600 / 5 = 1120
    expect(data.avgLatencyMs).toBeCloseTo(1120, 5);
    // newAvg = (0.03*4 + 0.01) / 5 = 0.13 / 5 = 0.026
    expect(data.avgCostUsd).toBeCloseTo(0.026, 5);
    expect(data.sampleCount).toBe(5);
  });

  it("EWMA: 0.7 * current + 0.3 * previous", async () => {
    const existing = makeExistingPerf({ ewmaReward: 0.6 });
    vi.mocked(prisma.recipePerformance.findUnique).mockResolvedValue(existing as any);

    await updateRecipePerformance("recipe-1", "sync.code-gen", {
      ...BASE_OUTCOME,
      reward: 0.9,
    });

    const data = vi.mocked(prisma.recipePerformance.update).mock.calls[0][0].data;
    // newEwma = 0.7 * 0.9 + 0.3 * 0.6 = 0.63 + 0.18 = 0.81
    expect(data.ewmaReward).toBeCloseTo(0.81, 5);
  });

  it("schema valid rate tracks boolean outcomes", async () => {
    const existing = makeExistingPerf({
      sampleCount: 4,
      avgSchemaValidRate: 0.75, // 3/4 true
    });
    vi.mocked(prisma.recipePerformance.findUnique).mockResolvedValue(existing as any);

    await updateRecipePerformance("recipe-1", "sync.code-gen", {
      ...BASE_OUTCOME,
      schemaValid: false,
    });

    const data = vi.mocked(prisma.recipePerformance.update).mock.calls[0][0].data;
    // newRate = (0.75*4 + 0) / 5 = 3.0 / 5 = 0.6
    expect(data.avgSchemaValidRate).toBeCloseTo(0.6, 5);
  });

  it("null schema/tool values don't affect rates", async () => {
    const existing = makeExistingPerf({
      avgSchemaValidRate: 0.75,
      avgToolSuccessRate: null,
    });
    vi.mocked(prisma.recipePerformance.findUnique).mockResolvedValue(existing as any);

    await updateRecipePerformance("recipe-1", "sync.code-gen", {
      ...BASE_OUTCOME,
      schemaValid: null,
      toolSuccess: null,
    });

    const data = vi.mocked(prisma.recipePerformance.update).mock.calls[0][0].data;
    // Both null → rates should remain unchanged
    expect(data.avgSchemaValidRate).toBe(0.75);
    expect(data.avgToolSuccessRate).toBeNull();
  });

  it("triggers evaluation at sample count multiples of 50", async () => {
    const existing = makeExistingPerf({ sampleCount: 49 });
    vi.mocked(prisma.recipePerformance.findUnique).mockResolvedValue(existing as any);

    await updateRecipePerformance("recipe-1", "sync.code-gen", BASE_OUTCOME);

    // sampleCount becomes 50, should trigger evaluatePromotions
    expect(evaluatePromotions).toHaveBeenCalledWith("sync.code-gen");
  });

  it("does NOT trigger evaluation at non-50 multiples", async () => {
    const existing = makeExistingPerf({ sampleCount: 48 });
    vi.mocked(prisma.recipePerformance.findUnique).mockResolvedValue(existing as any);

    await updateRecipePerformance("recipe-1", "sync.code-gen", BASE_OUTCOME);

    // sampleCount becomes 49, should NOT trigger
    expect(evaluatePromotions).not.toHaveBeenCalled();
  });

  it("catches errors without throwing", async () => {
    vi.mocked(prisma.recipePerformance.findUnique).mockRejectedValue(
      new Error("DB down"),
    );

    await expect(
      updateRecipePerformance("recipe-1", "sync.code-gen", BASE_OUTCOME),
    ).resolves.toBeUndefined();
  });
});
