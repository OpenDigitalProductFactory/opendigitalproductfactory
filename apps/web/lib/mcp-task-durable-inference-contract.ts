import { err, ok, type ActionResult } from "@/lib/shared/action-result";

export const DURABLE_INFERENCE_TASK_RECIPE_ID = "durable-inference.one-shot.v1" as const;
export const DURABLE_INFERENCE_TASK_CONTRACT_FAMILY =
  "background.mcp-durable-inference-one-shot" as const;

export type DurableInferenceTaskRecipeId = typeof DURABLE_INFERENCE_TASK_RECIPE_ID;

export type DurableInferenceTaskMetadata = {
  schemaVersion: 1;
  recipeId: DurableInferenceTaskRecipeId;
};

export type DurableInferenceProgress = {
  schemaVersion: 1;
  recipeId: DurableInferenceTaskRecipeId;
  state: "admitting" | "admitted";
  attempt: number;
  asyncOperationId?: string;
  routingRecipeId?: string;
  cancellationRequestedAt?: string;
};

export type DurableInferenceExecutionRecipeIdentity = {
  id: string;
  modelId: string;
};

export const DURABLE_INFERENCE_TASK_RECIPE = Object.freeze({
  id: DURABLE_INFERENCE_TASK_RECIPE_ID,
  taskType: "mcp-durable-inference-one-shot",
  contractFamily: DURABLE_INFERENCE_TASK_CONTRACT_FAMILY,
  providerId: "gemini",
  interactionMode: "background" as const,
  sensitivity: "internal" as const,
  maxDurationMs: 15 * 60 * 1_000,
  systemPrompt: [
    "Complete the user's bounded one-shot inference request.",
    "Return only the final answer; do not request or invoke tools and do not claim side effects.",
  ].join(" "),
});

function exactScalarPolicy(
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

/**
 * Revalidate the complete closed execution-plan fingerprint persisted with an
 * admitted operation. This is used both after routing and when reconciliation
 * repairs the operation-created/TaskRun-projection crash window.
 */
export function exactDurableInferenceExecutionRecipeId(input: {
  executionPlan: unknown;
  recipes: readonly DurableInferenceExecutionRecipeIdentity[];
}): string | null {
  if (!input.executionPlan || typeof input.executionPlan !== "object" || Array.isArray(input.executionPlan)) {
    return null;
  }
  const plan = input.executionPlan as Record<string, unknown>;
  const recipeId = typeof plan["recipeId"] === "string" ? plan["recipeId"].trim() : "";
  const modelId = typeof plan["modelId"] === "string" ? plan["modelId"].trim() : "";
  if (
    !recipeId
    || !modelId
    || plan["providerId"] !== DURABLE_INFERENCE_TASK_RECIPE.providerId
    || plan["contractFamily"] !== DURABLE_INFERENCE_TASK_CONTRACT_FAMILY
    || plan["executionAdapter"] !== "async"
    || plan["maxTokens"] !== 4_096
    || !exactScalarPolicy(plan["providerSettings"], {})
    || !exactScalarPolicy(plan["toolPolicy"], {
      toolChoice: "none",
      allowParallelToolCalls: false,
    })
    || !exactScalarPolicy(plan["responsePolicy"], {
      strictSchema: false,
      stream: false,
    })
    || !input.recipes.some((recipe) => recipe.id === recipeId && recipe.modelId === modelId)
  ) return null;
  return recipeId;
}

export function parseDurableInferenceTaskRecipeId(
  value: unknown,
): ActionResult<{ recipeId: DurableInferenceTaskRecipeId | null }> {
  if (value === undefined) return ok({ recipeId: null });
  if (value === DURABLE_INFERENCE_TASK_RECIPE_ID) {
    return ok({ recipeId: DURABLE_INFERENCE_TASK_RECIPE_ID });
  }
  return err(`tasks/submit params.recipeId must be ${DURABLE_INFERENCE_TASK_RECIPE_ID}`);
}

export function parseDurableInferenceTaskMetadata(
  value: unknown,
): DurableInferenceTaskMetadata | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const row = value as Record<string, unknown>;
  if (
    row["schemaVersion"] !== 1
    || row["recipeId"] !== DURABLE_INFERENCE_TASK_RECIPE_ID
    || Object.keys(row).some((key) => key !== "schemaVersion" && key !== "recipeId")
  ) return null;
  return {
    schemaVersion: 1,
    recipeId: DURABLE_INFERENCE_TASK_RECIPE_ID,
  };
}

export function durableInferenceTaskMetadata(
  recipeId: DurableInferenceTaskRecipeId,
): DurableInferenceTaskMetadata {
  if (recipeId !== DURABLE_INFERENCE_TASK_RECIPE_ID) {
    throw new Error("DURABLE_INFERENCE_TASK_RECIPE_INVALID");
  }
  return { schemaVersion: 1, recipeId };
}

function optionalString(value: unknown): string | null {
  return typeof value === "string" && value.trim().length > 0 ? value.trim() : null;
}

export function parseDurableInferenceProgress(value: unknown): DurableInferenceProgress | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const progress = value as Record<string, unknown>;
  if (
    progress["schemaVersion"] !== 1
    || progress["recipeId"] !== DURABLE_INFERENCE_TASK_RECIPE_ID
    || (progress["state"] !== "admitting" && progress["state"] !== "admitted")
    || !Number.isInteger(progress["attempt"])
    || Number(progress["attempt"]) < 1
  ) return null;
  const asyncOperationId = optionalString(progress["asyncOperationId"]);
  const routingRecipeId = optionalString(progress["routingRecipeId"]);
  const cancellationRequestedAt = optionalString(progress["cancellationRequestedAt"]);
  if (progress["state"] === "admitted" && (!asyncOperationId || !routingRecipeId)) return null;
  return {
    schemaVersion: 1,
    recipeId: DURABLE_INFERENCE_TASK_RECIPE_ID,
    state: progress["state"],
    attempt: Number(progress["attempt"]),
    ...(asyncOperationId ? { asyncOperationId } : {}),
    ...(routingRecipeId ? { routingRecipeId } : {}),
    ...(cancellationRequestedAt ? { cancellationRequestedAt } : {}),
  };
}
