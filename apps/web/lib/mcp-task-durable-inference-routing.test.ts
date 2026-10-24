import { describe, expect, it, vi } from "vitest";

const db = vi.hoisted(() => ({
  findRecipe: vi.fn(),
  findRecipes: vi.fn(),
}));

vi.mock("@dpf/db", () => ({
  prisma: {
    executionRecipe: {
      findFirst: (...args: unknown[]) => db.findRecipe(...args),
      findMany: (...args: unknown[]) => db.findRecipes(...args),
    },
  },
}));

import { inferContract } from "@/lib/routing/request-contract";
import { selectRecipeWithExploration } from "@/lib/routing/champion-challenger";
import { buildPlanFromRecipe } from "@/lib/routing/execution-plan";
import {
  DURABLE_INFERENCE_TASK_CONTRACT_FAMILY,
  DURABLE_INFERENCE_TASK_RECIPE,
} from "./mcp-task-durable-inference-contract";

describe("durable inference recipe selection", () => {
  it("selects the seeded champion and builds the real async execution plan", async () => {
    const recipe = {
      id: "recipe-durable-1",
      providerId: "gemini",
      modelId: "gemini-3.1-pro-preview",
      contractFamily: DURABLE_INFERENCE_TASK_CONTRACT_FAMILY,
      version: 1,
      status: "champion",
      origin: "seed",
      executionAdapter: "async",
      providerSettings: { max_tokens: 4_096 },
      toolPolicy: { toolChoice: "none", allowParallelToolCalls: false },
      responsePolicy: { strictSchema: false, stream: false },
    };
    db.findRecipe.mockResolvedValueOnce(recipe);
    db.findRecipes.mockResolvedValueOnce([{ ...recipe, id: "candidate-recipe", status: "candidate" }]);
    vi.spyOn(Math, "random").mockReturnValue(0);
    const contract = await inferContract(
      DURABLE_INFERENCE_TASK_RECIPE.taskType,
      [{ role: "user", content: "Produce a bounded answer." }],
      [],
      undefined,
      { sensitivity: "internal", interactionMode: "background", budgetClass: "quality_first" },
      null,
    );

    expect(contract.contractFamily).toBe(DURABLE_INFERENCE_TASK_CONTRACT_FAMILY);
    const selected = await selectRecipeWithExploration(
      recipe.providerId,
      recipe.modelId,
      contract,
    );
    expect(selected).toEqual({ recipe, explorationMode: "champion" });
    expect(buildPlanFromRecipe(selected.recipe!, contract)).toMatchObject({
      providerId: "gemini",
      modelId: recipe.modelId,
      recipeId: recipe.id,
      contractFamily: DURABLE_INFERENCE_TASK_CONTRACT_FAMILY,
      executionAdapter: "async",
      toolPolicy: { toolChoice: "none", allowParallelToolCalls: false },
      responsePolicy: { strictSchema: false, stream: false },
    });
  });
});
