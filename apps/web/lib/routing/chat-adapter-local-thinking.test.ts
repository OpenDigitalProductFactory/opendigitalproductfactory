import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { AdapterRequest } from "./adapter-types";
import type { RoutedExecutionPlan } from "./recipe-types";
import { chatAdapter } from "./chat-adapter";

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
    messages: [{ role: "user", content: "Hello" }],
    systemPrompt: "You are helpful.",
    ...overrides,
  };
}

describe("chat adapter local tool thinking", () => {
  let mockFetch: ReturnType<typeof vi.fn>;

  beforeEach(() => {
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
});
