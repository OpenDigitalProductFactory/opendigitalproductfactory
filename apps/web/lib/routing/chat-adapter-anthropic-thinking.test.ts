import { describe, expect, it, vi } from "vitest";
import { chatAdapter } from "./chat-adapter";
import { buildSeedRecipe } from "./recipe-seeder";
import { EMPTY_CAPABILITIES } from "./model-card-types";
import type { RoutedExecutionPlan } from "./recipe-types";
import { buildPlanFromRecipe } from "./execution-plan";
import type { RequestContract } from "./request-contract";

describe("Anthropic adaptive thinking wire composition", () => {
  it("recompiles an existing manual recipe using the current model capabilities", async () => {
    const contract: RequestContract = { contractId: "synthetic", contractFamily: "sync.review", taskType: "review",
      modality: { input: ["text"], output: ["text"] }, interactionMode: "sync", sensitivity: "internal",
      requiresTools: false, requiresStrictSchema: false, requiresStreaming: false,
      estimatedInputTokens: 8000, estimatedOutputTokens: 2000, reasoningDepth: "high", budgetClass: "balanced" };
    const plan = buildPlanFromRecipe({ id: "existing-manual", providerId: "anthropic", modelId: "capability-selected-model",
      contractFamily: "sync.review", version: 1, status: "active", origin: "seed", executionAdapter: "chat",
      providerSettings: { max_tokens: 4000, thinking: { type: "enabled", budget_tokens: 8192 } },
      toolPolicy: {}, responsePolicy: {},
    }, contract, { providerId: "anthropic", modelId: "capability-selected-model", modelFamily: null,
      modelClass: "chat", maxOutputTokens: 16000,
      capabilities: { ...EMPTY_CAPABILITIES, thinking: true, adaptiveThinking: true } });
    expect(plan.maxTokens).toBe(4000);
    expect(plan.providerSettings).toMatchObject({ thinking: { type: "adaptive" }, output_config: { effort: "high" } });
    const fetchImpl = vi.fn().mockResolvedValue({ ok: true, headers: new Headers(), json: async () => ({ content: [], usage: {} }) });
    await chatAdapter.execute({ providerId: "anthropic", modelId: plan.modelId, plan,
      provider: { baseUrl: "https://api.anthropic.com/v1", headers: {} }, fetchImpl, messages: [], systemPrompt: "" });
    const body = JSON.parse(fetchImpl.mock.calls[0]![1].body);
    expect(body).toMatchObject({ thinking: { type: "adaptive" }, output_config: { effort: "high" }, max_tokens: 4000 });
    expect(body.thinking).not.toHaveProperty("budget_tokens");
  });

  it.each(["medium", "high"])("serializes capability-aware %s effort with the admitted total", async (reasoningDepth) => {
    const recipe = buildSeedRecipe("anthropic", "capability-selected-model", "sync.review", {
      capabilities: { ...EMPTY_CAPABILITIES, thinking: true, adaptiveThinking: true },
      maxOutputTokens: 16000, modelClass: "chat",
    }, { estimatedOutputTokens: 2000, reasoningDepth, budgetClass: "balanced",
      requiresTools: false, requiresStrictSchema: false, requiresStreaming: false });
    const plan: RoutedExecutionPlan = {
      ...recipe, providerId: "anthropic", modelId: "capability-selected-model", recipeId: null,
      contractFamily: "sync.review", maxTokens: 4000, completionAllowance: 4000, temperature: 0.7,
      // Explicit provider configuration has precedence over late generic caller effort.
      providerSettings: { ...recipe.providerSettings, effort: "max" },
    };
    const fetchImpl = vi.fn().mockResolvedValue({ ok: true, headers: new Headers(),
      json: async () => ({ content: [{ type: "text", text: "Synthetic guidance" }], usage: {} }) });
    await chatAdapter.execute({ providerId: plan.providerId, modelId: plan.modelId, plan,
      provider: { baseUrl: "https://api.anthropic.com/v1", headers: {} }, fetchImpl,
      messages: [{ role: "user", content: "Read-only synthetic guidance" }], systemPrompt: "Give guidance only." });
    const body = JSON.parse(fetchImpl.mock.calls[0]![1].body);
    expect(body.thinking).toEqual({ type: "adaptive" });
    expect(body.output_config).toEqual({ effort: reasoningDepth });
    expect(body.max_tokens).toBe(4000);
    expect(body).not.toHaveProperty("temperature");
    expect(body).not.toHaveProperty("effort");
  });
});
