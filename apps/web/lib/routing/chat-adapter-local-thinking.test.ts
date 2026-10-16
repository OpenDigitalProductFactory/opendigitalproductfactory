import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { AdapterRequest } from "./adapter-types";
import type { RoutedExecutionPlan } from "./recipe-types";
import { chatAdapter } from "./chat-adapter";
const getLocalThinkingBudgetEvidence = vi.fn();
const evidence = { dialect: "llama.cpp-b9879" as const, modelDigest: "digest", engineIdentity: "engine", templateDigest: "template", configDigest: "config", observedAt: Date.now() };

// The chat-adapter suite is at its module-size ceiling, so this wiring check
// lives beside it. The helper's own cases are in local-tool-thinking.test.ts.

function makePlan(overrides: Partial<RoutedExecutionPlan> = {}): RoutedExecutionPlan {
  return {
    providerId: "local",
    modelId: "huggingface.co/ggml-org/qwen3.8-27b-gguf:Q4_K_M",
    recipeId: null,
    contractFamily: "sync.greeting",
    executionAdapter: "chat",
    maxTokens: 2048,
    providerSettings: {},
    toolPolicy: {},
    responsePolicy: {},
    ...overrides,
  };
}

function makeRequest(overrides: Partial<AdapterRequest> = {}): AdapterRequest {
  return {
    providerId: "local",
    modelId: "huggingface.co/ggml-org/qwen3.8-27b-gguf:Q4_K_M",
    plan: makePlan(),
    provider: {
      baseUrl: "http://model-runner.docker.internal",
      headers: { "Content-Type": "application/json" },
    },
    fetchImpl: globalThis.fetch,
    readLocalThinkingBudgetEvidence: getLocalThinkingBudgetEvidence,
    messages: [{ role: "user", content: "Hello" }],
    systemPrompt: "You are helpful.",
    ...overrides,
  };
}

describe("chat adapter local tool thinking", () => {
  let mockFetch: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    vi.mocked(getLocalThinkingBudgetEvidence).mockResolvedValue({ ...evidence, observedAt: Date.now() });
    mockFetch = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({
        choices: [{ message: { content: "No." }, finish_reason: "stop" }],
        usage: { prompt_tokens: 4, completion_tokens: 1 },
      }),
      headers: new Headers(),
    });
    vi.stubGlobal("fetch", mockFetch);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("asks a local tool turn to skip the thinking trace", async () => {
    await chatAdapter.execute(makeRequest({
      tools: [{ type: "function", function: { name: "list_items", description: "List", parameters: { type: "object" } } }],
    }));

    const sentBody = JSON.parse(mockFetch.mock.calls[0][1].body);
    expect(sentBody.chat_template_kwargs).toEqual({ enable_thinking: false });
  });

  it("does not disable thinking on a local answer that has no tools", async () => {
    await chatAdapter.execute(makeRequest());

    const sentBody = JSON.parse(mockFetch.mock.calls[0][1].body);
    expect(sentBody.chat_template_kwargs).toBeUndefined();
  });

  it("carries an admitted numeric thinking allowance to the actual local request", async () => {
    await chatAdapter.execute(makeRequest({
      plan: makePlan({ maxTokens: 16384, providerSettings: { thinking_budget_tokens: 12288 }, localThinkingBudgetEvidence: evidence }),
    }));
    const sentBody = JSON.parse(mockFetch.mock.calls[0][1].body);
    expect(sentBody.thinking_budget_tokens).toBe(12288);
    expect(sentBody.max_tokens).toBe(16384);
    expect(sentBody.chat_template_kwargs).toBeUndefined();
  });

  it("refuses dispatch when the queued request's selected template changed", async () => {
    vi.mocked(getLocalThinkingBudgetEvidence).mockResolvedValue({ ...evidence, templateDigest: "changed" });
    await expect(chatAdapter.execute(makeRequest({ plan: makePlan({
      maxTokens: 16384, providerSettings: { thinking_budget_tokens: 12288 }, localThinkingBudgetEvidence: evidence,
    }) }))).rejects.toThrow(/runtime|evidence/i);
    expect(mockFetch).not.toHaveBeenCalled();
  });

  it("refuses an unsupported numeric allowance before paid dispatch", async () => {
    await expect(chatAdapter.execute(makeRequest({ plan: makePlan({
      maxTokens: 16384, providerSettings: { thinking_budget_tokens: 12288 },
    }) }))).rejects.toThrow(/runtime|evidence/i);
    expect(mockFetch).not.toHaveBeenCalled();
  });

  it("keeps an activity total on the actual Anthropic wire", async () => {
    await chatAdapter.execute(makeRequest({ providerId: "anthropic", plan: makePlan({
      providerId: "anthropic", maxTokens: 16384, completionAllowance: 16384,
      providerSettings: { thinking: { type: "enabled", budget_tokens: 15000 } },
    }) }));
    const body = JSON.parse(mockFetch.mock.calls[0][1].body);
    expect(body.max_tokens).toBe(16384);
    expect(body.thinking.budget_tokens).toBeLessThanOrEqual(12288);
  });
  it("bounds a fallback effort-derived budget inside a smaller activity total", async () => {
    await chatAdapter.execute(makeRequest({ providerId: "anthropic", plan: makePlan({
      providerId: "anthropic", maxTokens: 8192, completionAllowance: 8192, providerSettings: { effort: "high" },
    }) }));
    const body = JSON.parse(mockFetch.mock.calls[0][1].body);
    expect(body.max_tokens).toBe(8192);
    expect(body.thinking.budget_tokens).toBe(6144);
  });
  it("preserves the existing unbound Anthropic completion contract", async () => {
    await chatAdapter.execute(makeRequest({ providerId: "anthropic", plan: makePlan({
      providerId: "anthropic", maxTokens: 16384, providerSettings: { thinking: { type: "enabled", budget_tokens: 15000 } },
    }) }));
    expect(JSON.parse(mockFetch.mock.calls[0][1].body).max_tokens).toBe(17048);
  });
});
