import { prisma } from "@dpf/db";
import { routeAndCall } from "@/lib/inference/routed-inference";

import {
  DURABLE_INFERENCE_TASK_BACKGROUND_MODEL_ID,
  DURABLE_INFERENCE_TASK_CONTRACT_FAMILY,
  DURABLE_INFERENCE_TASK_RECIPE,
  DURABLE_INFERENCE_TASK_RECIPE_ID,
  exactDurableInferenceExecutionRecipeId,
  type DurableInferenceTaskRecipeId,
} from "./mcp-task-durable-inference-contract";

type RecipeRow = {
  id: string;
  providerId: string;
  modelId: string;
  contractFamily: string;
  version: number;
  status: string;
  origin: string;
  executionAdapter: string;
  providerSettings: unknown;
  toolPolicy: unknown;
  responsePolicy: unknown;
};

function isUniqueConflict(error: unknown): boolean {
  return Boolean(error && typeof error === "object" && "code" in error && error.code === "P2002");
}

function hasExactScalarPolicy(
  value: unknown,
  expected: Readonly<Record<string, string | number | boolean>>,
): boolean {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const actual = value as Record<string, unknown>;
  const actualKeys = Object.keys(actual).sort();
  const expectedKeys = Object.keys(expected).sort();
  return actualKeys.length === expectedKeys.length
    && actualKeys.every((key, index) => key === expectedKeys[index])
    && expectedKeys.every((key) => actual[key] === expected[key]);
}

function validateRecipe(recipe: RecipeRow | null, modelId: string): RecipeRow {
  if (
    !recipe
    || recipe.providerId !== DURABLE_INFERENCE_TASK_RECIPE.providerId
    || recipe.modelId !== modelId
    || recipe.contractFamily !== DURABLE_INFERENCE_TASK_CONTRACT_FAMILY
    || recipe.version !== 1
    || recipe.status !== "champion"
    || recipe.origin !== "seed"
    || recipe.executionAdapter !== "async"
    || !hasExactScalarPolicy(recipe.providerSettings, { max_tokens: 4_096 })
    || !hasExactScalarPolicy(recipe.toolPolicy, { toolChoice: "none", allowParallelToolCalls: false })
    || !hasExactScalarPolicy(recipe.responsePolicy, { strictSchema: false, stream: false })
  ) {
    throw new Error("DURABLE_INFERENCE_RECIPE_INVALID");
  }
  return recipe;
}

/**
 * Seed the closed recipe only for the server-certified Gemini background
 * model. A general chat/reasoning profile is not evidence that the model
 * supports the Interactions API's background mode.
 */
export async function ensureDurableInferenceTaskRecipes(): Promise<{
  seeded: number;
  validated: number;
  recipeIds: string[];
  recipes: Array<{ id: string; modelId: string }>;
}> {
  const profiles = await prisma.modelProfile.findMany({
    where: {
      providerId: DURABLE_INFERENCE_TASK_RECIPE.providerId,
      modelId: DURABLE_INFERENCE_TASK_BACKGROUND_MODEL_ID,
      modelStatus: { in: ["active", "degraded"] },
      modelClass: { in: ["chat", "reasoning"] },
    },
    select: { modelId: true },
  });
  let seeded = 0;
  let validated = 0;
  const recipeIds: string[] = [];
  const recipes: Array<{ id: string; modelId: string }> = [];
  for (const profile of profiles.filter((candidate) =>
    candidate.modelId === DURABLE_INFERENCE_TASK_BACKGROUND_MODEL_ID)) {
    let recipe = await prisma.executionRecipe.findFirst({
      where: {
        providerId: DURABLE_INFERENCE_TASK_RECIPE.providerId,
        modelId: profile.modelId,
        contractFamily: DURABLE_INFERENCE_TASK_CONTRACT_FAMILY,
        status: "champion",
      },
      orderBy: { version: "desc" },
    }) as RecipeRow | null;
    if (!recipe) {
      try {
        recipe = await prisma.executionRecipe.create({
          data: {
            providerId: DURABLE_INFERENCE_TASK_RECIPE.providerId,
            modelId: profile.modelId,
            contractFamily: DURABLE_INFERENCE_TASK_CONTRACT_FAMILY,
            version: 1,
            status: "champion",
            origin: "seed",
            executionAdapter: "async",
            providerSettings: { max_tokens: 4_096 },
            toolPolicy: { toolChoice: "none", allowParallelToolCalls: false },
            responsePolicy: { strictSchema: false, stream: false },
          },
        }) as RecipeRow;
        seeded += 1;
      } catch (error) {
        if (!isUniqueConflict(error)) throw error;
        recipe = await prisma.executionRecipe.findFirst({
          where: {
            providerId: DURABLE_INFERENCE_TASK_RECIPE.providerId,
            modelId: profile.modelId,
            contractFamily: DURABLE_INFERENCE_TASK_CONTRACT_FAMILY,
            status: "champion",
          },
          orderBy: { version: "desc" },
        }) as RecipeRow | null;
      }
    }
    const validatedRecipe = validateRecipe(recipe, profile.modelId);
    recipeIds.push(validatedRecipe.id);
    recipes.push({ id: validatedRecipe.id, modelId: validatedRecipe.modelId });
    validated += 1;
  }
  return { seeded, validated, recipeIds, recipes };
}

export async function admitDurableInferenceTask(input: {
  taskRunId: string;
  requestKey: string;
  requestDigest: string;
  prompt: string;
  userId: string;
  agentId: string;
  threadId: string;
  routeContext: string;
  recipeId: DurableInferenceTaskRecipeId;
}): Promise<{ asyncOperationId: string; recipeId: string }> {
  if (input.recipeId !== DURABLE_INFERENCE_TASK_RECIPE_ID) {
    throw new Error("DURABLE_INFERENCE_TASK_RECIPE_INVALID");
  }
  const seeded = await ensureDurableInferenceTaskRecipes();
  if (
    seeded.recipes.length !== 1
    || seeded.recipes[0]?.modelId !== DURABLE_INFERENCE_TASK_BACKGROUND_MODEL_ID
  ) {
    throw new Error("DURABLE_INFERENCE_BACKGROUND_MODEL_UNAVAILABLE");
  }
  const result = await routeAndCall(
    [{ role: "user", content: input.prompt }],
    DURABLE_INFERENCE_TASK_RECIPE.systemPrompt,
    DURABLE_INFERENCE_TASK_RECIPE.sensitivity,
    {
      taskType: DURABLE_INFERENCE_TASK_RECIPE.taskType,
      interactionMode: DURABLE_INFERENCE_TASK_RECIPE.interactionMode,
      maxDurationMs: DURABLE_INFERENCE_TASK_RECIPE.maxDurationMs,
      tools: [],
      toolChoice: "none",
      requireTools: false,
      allowedProviders: [DURABLE_INFERENCE_TASK_RECIPE.providerId],
      preferredProviderId: DURABLE_INFERENCE_TASK_RECIPE.providerId,
      preferredModelId: DURABLE_INFERENCE_TASK_BACKGROUND_MODEL_ID,
      budgetClass: "quality_first",
      messageOrigins: ["turn"],
      systemPromptInstructionSpans: [DURABLE_INFERENCE_TASK_RECIPE.systemPrompt],
      agentId: input.agentId,
      threadId: input.threadId,
      routeContext: input.routeContext,
      durableAsyncOperation: {
        request: {
          kind: "task-run",
          taskRunId: input.taskRunId,
          requestKey: input.requestKey,
          requestDigest: input.requestDigest,
        },
        actor: {
          userId: input.userId,
          agentId: input.agentId,
          principalId: null,
          isSuperuser: false,
        },
        expectedExecution: {
          providerId: DURABLE_INFERENCE_TASK_RECIPE.providerId,
          contractFamily: DURABLE_INFERENCE_TASK_CONTRACT_FAMILY,
          executionAdapter: "async",
          explorationMode: "champion",
          plans: seeded.recipes.map((recipe) => ({
            recipeId: recipe.id,
            modelId: recipe.modelId,
            maxTokens: 4_096,
            providerSettings: {},
            toolPolicy: { toolChoice: "none", allowParallelToolCalls: false },
            responsePolicy: { strictSchema: false, stream: false },
          })),
        },
        deferInitialWake: true,
      },
    },
  );
  const plan = result.routeDecision.executionPlan;
  const selectedRecipeId = exactDurableInferenceExecutionRecipeId({
    executionPlan: plan,
    recipes: seeded.recipes,
  });
  if (
    !result.asyncOperationId
    || !selectedRecipeId
    || result.routeDecision.explorationMode !== "champion"
  ) {
    throw new Error("DURABLE_INFERENCE_ASYNC_RECIPE_NOT_SELECTED");
  }
  return { asyncOperationId: result.asyncOperationId, recipeId: selectedRecipeId };
}
