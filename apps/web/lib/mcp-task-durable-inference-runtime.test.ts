import { beforeEach, describe, expect, it, vi } from "vitest";

const db = vi.hoisted(() => ({
  findProfiles: vi.fn(),
  findRecipe: vi.fn(),
  createRecipe: vi.fn(),
}));
const inference = vi.hoisted(() => ({ route: vi.fn() }));

vi.mock("@dpf/db", () => ({
  prisma: {
    modelProfile: { findMany: (...args: unknown[]) => db.findProfiles(...args) },
    executionRecipe: {
      findFirst: (...args: unknown[]) => db.findRecipe(...args),
      create: (...args: unknown[]) => db.createRecipe(...args),
    },
  },
}));
vi.mock("@/lib/inference/routed-inference", () => ({
  routeAndCall: (...args: unknown[]) => inference.route(...args),
}));

import {
  admitDurableInferenceTask,
  ensureDurableInferenceTaskRecipes,
} from "./mcp-task-durable-inference-runtime";
import {
  DURABLE_INFERENCE_TASK_BACKGROUND_MODEL_ID,
  DURABLE_INFERENCE_TASK_CONTRACT_FAMILY,
  DURABLE_INFERENCE_TASK_RECIPE_ID,
} from "./mcp-task-durable-inference-contract";

const selectedRecipe = {
  id: "recipe-db-1",
  providerId: "gemini",
  modelId: DURABLE_INFERENCE_TASK_BACKGROUND_MODEL_ID,
  contractFamily: DURABLE_INFERENCE_TASK_CONTRACT_FAMILY,
  version: 1,
  status: "champion",
  origin: "seed",
  executionAdapter: "async",
  providerSettings: { max_tokens: 4_096 },
  toolPolicy: { toolChoice: "none", allowParallelToolCalls: false },
  responsePolicy: { strictSchema: false, stream: false },
};

beforeEach(() => {
  vi.clearAllMocks();
  db.findProfiles.mockResolvedValue([{ modelId: selectedRecipe.modelId }]);
  db.findRecipe.mockResolvedValue(null);
  db.createRecipe.mockResolvedValue(selectedRecipe);
  inference.route.mockResolvedValue({
    asyncOperationId: "async-op-1",
    routeDecision: {
      explorationMode: "champion",
      executionPlan: {
        ...selectedRecipe,
        recipeId: selectedRecipe.id,
        maxTokens: 4_096,
        providerSettings: {},
      },
    },
  });
});

describe("durable-inference TaskRun runtime", () => {
  it("seeds only the server-certified Gemini background model", async () => {
    db.findProfiles.mockResolvedValueOnce([
      { modelId: "gemini-2.5-pro" },
      { modelId: DURABLE_INFERENCE_TASK_BACKGROUND_MODEL_ID },
      { modelId: "gemini-3-pro-image-preview" },
    ]);

    await expect(ensureDurableInferenceTaskRecipes()).resolves.toEqual({
      seeded: 1,
      validated: 1,
      recipeIds: [selectedRecipe.id],
      recipes: [{ id: selectedRecipe.id, modelId: selectedRecipe.modelId }],
    });

    expect(db.findProfiles).toHaveBeenCalledWith({
      where: {
        providerId: "gemini",
        modelId: DURABLE_INFERENCE_TASK_BACKGROUND_MODEL_ID,
        modelStatus: { in: ["active", "degraded"] },
        modelClass: { in: ["chat", "reasoning"] },
      },
      select: { modelId: true },
    });
    expect(db.createRecipe).toHaveBeenCalledWith({
      data: expect.objectContaining({
        providerId: "gemini",
        modelId: selectedRecipe.modelId,
        contractFamily: DURABLE_INFERENCE_TASK_CONTRACT_FAMILY,
        status: "champion",
        origin: "seed",
        executionAdapter: "async",
        toolPolicy: { toolChoice: "none", allowParallelToolCalls: false },
        responsePolicy: { strictSchema: false, stream: false },
      }),
    });
    expect(db.findRecipe).toHaveBeenCalledTimes(1);
    expect(db.createRecipe).toHaveBeenCalledTimes(1);
  });

  it("does not seed a recipe for Gemini models without certified background support", async () => {
    db.findProfiles.mockResolvedValueOnce([
      { modelId: "gemini-2.5-pro" },
      { modelId: "deep-research-pro-preview-12-2025" },
      { modelId: "gemini-3-pro-image-preview" },
    ]);

    await expect(ensureDurableInferenceTaskRecipes()).resolves.toEqual({
      seeded: 0,
      validated: 0,
      recipeIds: [],
      recipes: [],
    });
    expect(db.findRecipe).not.toHaveBeenCalled();
    expect(db.createRecipe).not.toHaveBeenCalled();
  });

  it("calls routed inference once with only server-derived TaskRun authority", async () => {
    const result = await admitDurableInferenceTask({
      taskRunId: "TR-MCP-DURABLE-1",
      requestKey: "durable:1",
      requestDigest: "a".repeat(64),
      prompt: "Produce a bounded market summary.",
      userId: "user-1",
      agentId: "AGT-WS-RESEARCH",
      threadId: "thread-1",
      routeContext: "/research",
      recipeId: DURABLE_INFERENCE_TASK_RECIPE_ID,
    });

    expect(inference.route).toHaveBeenCalledTimes(1);
    expect(inference.route).toHaveBeenCalledWith(
      [{ role: "user", content: "Produce a bounded market summary." }],
      expect.stringContaining("one-shot inference request"),
      "internal",
      expect.objectContaining({
        taskType: "mcp-durable-inference-one-shot",
        interactionMode: "background",
        budgetClass: "quality_first",
        allowedProviders: ["gemini"],
        preferredModelId: DURABLE_INFERENCE_TASK_BACKGROUND_MODEL_ID,
        tools: [],
        toolChoice: "none",
        durableAsyncOperation: {
          request: {
            kind: "task-run",
            taskRunId: "TR-MCP-DURABLE-1",
            requestKey: "durable:1",
            requestDigest: "a".repeat(64),
          },
          actor: {
            userId: "user-1",
            agentId: "AGT-WS-RESEARCH",
            principalId: null,
            isSuperuser: false,
          },
          expectedExecution: {
            providerId: "gemini",
            contractFamily: DURABLE_INFERENCE_TASK_CONTRACT_FAMILY,
            executionAdapter: "async",
            explorationMode: "champion",
            plans: [{
              recipeId: selectedRecipe.id,
              modelId: selectedRecipe.modelId,
              maxTokens: 4_096,
              providerSettings: {},
              toolPolicy: { toolChoice: "none", allowParallelToolCalls: false },
              responsePolicy: { strictSchema: false, stream: false },
            }],
          },
          deferInitialWake: true,
        },
      }),
    );
    expect(result).toEqual({ asyncOperationId: "async-op-1", recipeId: "recipe-db-1" });
  });

  it("fails before routing when the certified background model is unavailable", async () => {
    db.findProfiles.mockResolvedValueOnce([{ modelId: "gemini-2.5-pro" }]);

    await expect(admitDurableInferenceTask({
      taskRunId: "TR-MCP-DURABLE-1",
      requestKey: "durable:1",
      requestDigest: "a".repeat(64),
      prompt: "Produce a bounded market summary.",
      userId: "user-1",
      agentId: "AGT-WS-RESEARCH",
      threadId: "thread-1",
      routeContext: "/research",
      recipeId: DURABLE_INFERENCE_TASK_RECIPE_ID,
    })).rejects.toThrow("DURABLE_INFERENCE_BACKGROUND_MODEL_UNAVAILABLE");
    expect(inference.route).not.toHaveBeenCalled();
  });

  it("fails closed when routing does not select the seeded async recipe", async () => {
    inference.route.mockResolvedValueOnce({
      asyncOperationId: undefined,
      routeDecision: {
        explorationMode: "champion",
        executionPlan: {
          ...selectedRecipe,
          recipeId: null,
          executionAdapter: "chat",
        },
      },
    });

    await expect(admitDurableInferenceTask({
      taskRunId: "TR-MCP-DURABLE-1",
      requestKey: "durable:1",
      requestDigest: "a".repeat(64),
      prompt: "Produce a bounded market summary.",
      userId: "user-1",
      agentId: "AGT-WS-RESEARCH",
      threadId: "thread-1",
      routeContext: "/research",
      recipeId: DURABLE_INFERENCE_TASK_RECIPE_ID,
    })).rejects.toThrow("DURABLE_INFERENCE_ASYNC_RECIPE_NOT_SELECTED");
  });

  it("fails closed when routing selects a challenger instead of the exact seeded champion", async () => {
    inference.route.mockResolvedValueOnce({
      asyncOperationId: "async-op-2",
      routeDecision: {
        explorationMode: "challenger",
        executionPlan: { ...selectedRecipe, recipeId: "candidate-recipe" },
      },
    });

    await expect(admitDurableInferenceTask({
      taskRunId: "TR-MCP-DURABLE-1",
      requestKey: "durable:1",
      requestDigest: "a".repeat(64),
      prompt: "Produce a bounded market summary.",
      userId: "user-1",
      agentId: "AGT-WS-RESEARCH",
      threadId: "thread-1",
      routeContext: "/research",
      recipeId: DURABLE_INFERENCE_TASK_RECIPE_ID,
    })).rejects.toThrow("DURABLE_INFERENCE_ASYNC_RECIPE_NOT_SELECTED");
  });

  it("rejects an async route result for a model outside the certified recipe", async () => {
    inference.route.mockResolvedValueOnce({
      asyncOperationId: "async-op-wrong-model",
      routeDecision: {
        explorationMode: "champion",
        executionPlan: {
          ...selectedRecipe,
          recipeId: selectedRecipe.id,
          modelId: "gemini-2.5-pro",
          maxTokens: 4_096,
          providerSettings: {},
        },
      },
    });

    await expect(admitDurableInferenceTask({
      taskRunId: "TR-MCP-DURABLE-1",
      requestKey: "durable:1",
      requestDigest: "a".repeat(64),
      prompt: "Produce a bounded market summary.",
      userId: "user-1",
      agentId: "AGT-WS-RESEARCH",
      threadId: "thread-1",
      routeContext: "/research",
      recipeId: DURABLE_INFERENCE_TASK_RECIPE_ID,
    })).rejects.toThrow("DURABLE_INFERENCE_ASYNC_RECIPE_NOT_SELECTED");
  });
});
