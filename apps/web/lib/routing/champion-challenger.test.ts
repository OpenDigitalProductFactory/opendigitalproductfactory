/**
 * EP-INF-006: Champion/Challenger selection and promotion tests (TDD).
 */

import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";

vi.mock("@dpf/db", () => ({
  prisma: {
    executionRecipe: {
      findMany: vi.fn(),
      findUnique: vi.fn(),
      update: vi.fn(),
    },
    recipePerformance: {
      findUnique: vi.fn(),
    },
  },
}));

vi.mock("./recipe-loader", () => ({
  loadChampionRecipe: vi.fn(),
}));

import { prisma } from "@dpf/db";
import { loadChampionRecipe } from "./recipe-loader";
import {
  selectRecipeWithExploration,
  evaluatePromotions,
  promoteChallenger,
  _resetPromotionState,
} from "./champion-challenger";
import type { RequestContract } from "./request-contract";
import type { RecipeRow } from "./recipe-types";

// ── Fixtures ─────────────────────────────────────────────────────────────────

const CHAMPION: RecipeRow = {
  id: "champion-1",
  providerId: "openai",
  modelId: "gpt-4o",
  contractFamily: "sync.code-gen",
  version: 1,
  status: "champion",
  origin: "seed",
  providerSettings: {},
  toolPolicy: {},
  responsePolicy: {},
};

const CHALLENGER: RecipeRow = {
  id: "challenger-1",
  providerId: "openai",
  modelId: "gpt-4o",
  contractFamily: "sync.code-gen",
  version: 2,
  status: "candidate",
  origin: "mutation",
  providerSettings: {},
  toolPolicy: {},
  responsePolicy: {},
};

function makeContract(overrides: Partial<RequestContract> = {}): RequestContract {
  return {
    contractId: "test-contract",
    contractFamily: "sync.code-gen",
    taskType: "code-gen",
    modality: { input: ["text"], output: ["text"] },
    interactionMode: "sync",
    sensitivity: "internal",
    requiresTools: false,
    requiresStrictSchema: false,
    requiresStreaming: true,
    estimatedInputTokens: 500,
    estimatedOutputTokens: 200,
    reasoningDepth: "medium",
    budgetClass: "balanced",
    ...overrides,
  };
}

// ── selectRecipeWithExploration ──────────────────────────────────────────────

describe("selectRecipeWithExploration", () => {
  beforeEach(() => {
    vi.mocked(loadChampionRecipe).mockReset();
    vi.mocked(prisma.executionRecipe.findMany).mockReset();
  });

  it("returns null recipe when no champion exists", async () => {
    vi.mocked(loadChampionRecipe).mockResolvedValue(null);

    const result = await selectRecipeWithExploration("openai", "gpt-4o", makeContract());

    expect(result.recipe).toBeNull();
    expect(result.explorationMode).toBe("champion");
  });

  it("returns champion when no challengers exist", async () => {
    vi.mocked(loadChampionRecipe).mockResolvedValue(CHAMPION);
    vi.mocked(prisma.executionRecipe.findMany).mockResolvedValue([]);

    const result = await selectRecipeWithExploration("openai", "gpt-4o", makeContract());

    expect(result.recipe).toEqual(CHAMPION);
    expect(result.explorationMode).toBe("champion");
  });

  it("returns champion for confidential sensitivity", async () => {
    vi.mocked(loadChampionRecipe).mockResolvedValue(CHAMPION);

    const result = await selectRecipeWithExploration(
      "openai",
      "gpt-4o",
      makeContract({ sensitivity: "confidential" }),
    );

    expect(result.recipe).toEqual(CHAMPION);
    expect(result.explorationMode).toBe("champion");
    // Should not even query for challengers
    expect(prisma.executionRecipe.findMany).not.toHaveBeenCalled();
  });

  it("returns champion for restricted sensitivity", async () => {
    vi.mocked(loadChampionRecipe).mockResolvedValue(CHAMPION);

    const result = await selectRecipeWithExploration(
      "openai",
      "gpt-4o",
      makeContract({ sensitivity: "restricted" }),
    );

    expect(result.recipe).toEqual(CHAMPION);
    expect(result.explorationMode).toBe("champion");
    expect(prisma.executionRecipe.findMany).not.toHaveBeenCalled();
  });

  it("returns champion for quality_first budget", async () => {
    vi.mocked(loadChampionRecipe).mockResolvedValue(CHAMPION);

    const result = await selectRecipeWithExploration(
      "openai",
      "gpt-4o",
      makeContract({ budgetClass: "quality_first" }),
    );

    expect(result.recipe).toEqual(CHAMPION);
    expect(result.explorationMode).toBe("champion");
    expect(prisma.executionRecipe.findMany).not.toHaveBeenCalled();
  });

  it("returns challenger when Math.random < 0.02", async () => {
    vi.mocked(loadChampionRecipe).mockResolvedValue(CHAMPION);
    vi.mocked(prisma.executionRecipe.findMany).mockResolvedValue([CHALLENGER as any]);

    const randomSpy = vi.spyOn(Math, "random");
    // First call (exploration check): below threshold
    // Second call (challenger index selection): 0
    randomSpy.mockReturnValueOnce(0.01).mockReturnValueOnce(0);

    const result = await selectRecipeWithExploration("openai", "gpt-4o", makeContract());

    expect(result.recipe).toEqual(CHALLENGER);
    expect(result.explorationMode).toBe("challenger");

    randomSpy.mockRestore();
  });

  it("returns champion when Math.random >= 0.02", async () => {
    vi.mocked(loadChampionRecipe).mockResolvedValue(CHAMPION);
    vi.mocked(prisma.executionRecipe.findMany).mockResolvedValue([CHALLENGER as any]);

    const randomSpy = vi.spyOn(Math, "random").mockReturnValue(0.5);

    const result = await selectRecipeWithExploration("openai", "gpt-4o", makeContract());

    expect(result.recipe).toEqual(CHAMPION);
    expect(result.explorationMode).toBe("champion");

    randomSpy.mockRestore();
  });
});

// ── evaluatePromotions ───────────────────────────────────────────────────────

describe("evaluatePromotions", () => {
  beforeEach(() => {
    _resetPromotionState();
    vi.mocked(prisma.executionRecipe.findMany).mockReset();
    vi.mocked(prisma.executionRecipe.findUnique).mockReset();
    vi.mocked(prisma.executionRecipe.update).mockReset();
    vi.mocked(prisma.recipePerformance.findUnique).mockReset();
    vi.mocked(prisma.executionRecipe.update).mockResolvedValue({} as any);
  });

  function mockPromotionScenario(opts: {
    championSamples?: number;
    championEwma?: number;
    championCost?: number;
    championSchemaRate?: number | null;
    challengerSamples?: number;
    challengerEwma?: number;
    challengerCost?: number;
    challengerSchemaRate?: number | null;
  }) {
    const {
      championSamples = 100,
      championEwma = 0.6,
      championCost = 0.03,
      championSchemaRate = 0.9,
      challengerSamples = 25,
      challengerEwma = 0.7,
      challengerCost = 0.035,
      challengerSchemaRate = 0.95,
    } = opts;

    vi.mocked(prisma.executionRecipe.findMany)
      .mockResolvedValueOnce([CHAMPION as any]) // champions for contract family
      .mockResolvedValueOnce([CHALLENGER as any]); // challengers for champion

    vi.mocked(prisma.recipePerformance.findUnique)
      .mockResolvedValueOnce({
        recipeId: CHAMPION.id,
        contractFamily: "sync.code-gen",
        sampleCount: championSamples,
        ewmaReward: championEwma,
        avgCostUsd: championCost,
        avgSchemaValidRate: championSchemaRate,
        avgToolSuccessRate: null,
      } as any)
      .mockResolvedValueOnce({
        recipeId: CHALLENGER.id,
        contractFamily: "sync.code-gen",
        sampleCount: challengerSamples,
        ewmaReward: challengerEwma,
        avgCostUsd: challengerCost,
        avgSchemaValidRate: challengerSchemaRate,
        avgToolSuccessRate: null,
      } as any);

    vi.mocked(prisma.executionRecipe.findUnique).mockResolvedValue({
      contractFamily: "sync.code-gen",
    } as any);
  }

  it("promotes when all gates pass", async () => {
    mockPromotionScenario({
      championEwma: 0.6,
      challengerEwma: 0.7, // >5% improvement
      championCost: 0.03,
      challengerCost: 0.035, // <50% increase
      challengerSamples: 25, // ≥20
    });

    await evaluatePromotions("sync.code-gen");

    // Old champion retired
    expect(prisma.executionRecipe.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: "champion-1" },
        data: expect.objectContaining({ status: "retired" }),
      }),
    );
    // Challenger promoted
    expect(prisma.executionRecipe.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: "challenger-1" },
        data: expect.objectContaining({ status: "champion" }),
      }),
    );
  });

  it("no promotion with < 20 samples", async () => {
    mockPromotionScenario({
      challengerSamples: 15,
      challengerEwma: 0.9, // great reward but not enough samples
    });

    await evaluatePromotions("sync.code-gen");

    // No updates (no promotion, no retirement since <40 samples)
    expect(prisma.executionRecipe.update).not.toHaveBeenCalled();
  });

  it("no promotion when reward improvement < 5%", async () => {
    mockPromotionScenario({
      championEwma: 0.6,
      challengerEwma: 0.62, // only ~3.3% improvement
      challengerSamples: 25,
    });

    await evaluatePromotions("sync.code-gen");

    // No promotion calls
    expect(prisma.executionRecipe.update).not.toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ status: "champion" }),
      }),
    );
  });

  it("no promotion when cost increase > 50%", async () => {
    mockPromotionScenario({
      championEwma: 0.6,
      challengerEwma: 0.7,
      championCost: 0.02,
      challengerCost: 0.04, // 100% increase
      challengerSamples: 25,
    });

    await evaluatePromotions("sync.code-gen");

    // No promotion calls
    expect(prisma.executionRecipe.update).not.toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ status: "champion" }),
      }),
    );
  });

  it("retires challenger after 40 samples without promotion", async () => {
    mockPromotionScenario({
      championEwma: 0.6,
      challengerEwma: 0.62, // insufficient improvement
      challengerSamples: 40, // ≥ retirement threshold
    });

    await evaluatePromotions("sync.code-gen");

    // Challenger should be retired (not promoted)
    expect(prisma.executionRecipe.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: "challenger-1" },
        data: expect.objectContaining({ status: "retired" }),
      }),
    );
    // Champion should NOT be retired
    expect(prisma.executionRecipe.update).not.toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: "champion-1" },
        data: expect.objectContaining({ status: "retired" }),
      }),
    );
  });

  it("anti-thrash: blocks second promotion within 24h", async () => {
    vi.useFakeTimers();

    try {
      // First promotion succeeds
      mockPromotionScenario({
        championEwma: 0.6,
        challengerEwma: 0.7,
        challengerSamples: 25,
      });

      await evaluatePromotions("sync.code-gen");
      expect(prisma.executionRecipe.update).toHaveBeenCalled();

      // Reset mocks for second attempt
      vi.mocked(prisma.executionRecipe.update).mockReset();
      vi.mocked(prisma.executionRecipe.update).mockResolvedValue({} as any);

      // Advance 1 hour (within 24h window)
      vi.advanceTimersByTime(60 * 60 * 1000);

      mockPromotionScenario({
        championEwma: 0.6,
        challengerEwma: 0.8,
        challengerSamples: 30,
      });

      await evaluatePromotions("sync.code-gen");

      // Should be blocked by anti-thrash
      expect(prisma.executionRecipe.update).not.toHaveBeenCalled();

      // Advance past 24h
      vi.advanceTimersByTime(24 * 60 * 60 * 1000);

      mockPromotionScenario({
        championEwma: 0.6,
        challengerEwma: 0.8,
        challengerSamples: 30,
      });

      await evaluatePromotions("sync.code-gen");

      // Should now proceed
      expect(prisma.executionRecipe.update).toHaveBeenCalled();
    } finally {
      vi.useRealTimers();
    }
  });
});
