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
