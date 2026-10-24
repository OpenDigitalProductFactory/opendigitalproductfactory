import { describe, expect, it } from "vitest";

import {
  DURABLE_INFERENCE_TASK_RECIPE_ID,
  parseDurableInferenceProgress,
  parseDurableInferenceTaskMetadata,
  parseDurableInferenceTaskRecipeId,
} from "./mcp-task-durable-inference-contract";

describe("closed durable-inference MCP Task contract", () => {
  it("accepts only the single server-owned one-shot recipe", () => {
    expect(parseDurableInferenceTaskRecipeId(undefined)).toEqual({ ok: true, data: { recipeId: null } });
    expect(parseDurableInferenceTaskRecipeId(DURABLE_INFERENCE_TASK_RECIPE_ID)).toEqual({
      ok: true,
      data: { recipeId: DURABLE_INFERENCE_TASK_RECIPE_ID },
    });
    expect(parseDurableInferenceTaskRecipeId("durable-inference.arbitrary.v1")).toEqual({
      ok: false,
      error: `tasks/submit params.recipeId must be ${DURABLE_INFERENCE_TASK_RECIPE_ID}`,
    });
    expect(parseDurableInferenceTaskRecipeId({ id: DURABLE_INFERENCE_TASK_RECIPE_ID })).toEqual({
      ok: false,
      error: `tasks/submit params.recipeId must be ${DURABLE_INFERENCE_TASK_RECIPE_ID}`,
    });
  });

  it("fails closed unless persisted mode metadata is exact", () => {
    expect(parseDurableInferenceTaskMetadata({
      schemaVersion: 1,
      recipeId: DURABLE_INFERENCE_TASK_RECIPE_ID,
    })).toEqual({
      schemaVersion: 1,
      recipeId: DURABLE_INFERENCE_TASK_RECIPE_ID,
    });
    expect(parseDurableInferenceTaskMetadata({
      schemaVersion: 2,
      recipeId: DURABLE_INFERENCE_TASK_RECIPE_ID,
    })).toBeNull();
    expect(parseDurableInferenceTaskMetadata({
      schemaVersion: 1,
      recipeId: "another-recipe",
    })).toBeNull();
  });

  it("parses only an exact durable admission projection", () => {
    expect(parseDurableInferenceProgress({
      schemaVersion: 1,
      recipeId: DURABLE_INFERENCE_TASK_RECIPE_ID,
      state: "admitting",
      attempt: 2,
      cancellationRequestedAt: "2026-09-04T14:00:00.000Z",
    })).toMatchObject({ state: "admitting", attempt: 2 });
    expect(parseDurableInferenceProgress({
      schemaVersion: 1,
      recipeId: DURABLE_INFERENCE_TASK_RECIPE_ID,
      state: "admitted",
      attempt: 1,
    })).toBeNull();
    expect(parseDurableInferenceProgress({
      schemaVersion: 1,
      recipeId: DURABLE_INFERENCE_TASK_RECIPE_ID,
      state: "arbitrary",
      attempt: 1,
    })).toBeNull();
  });
});
