// BI-B76DC66C — a ChatGPT endpoint is eligible for a strict-schema turn only
// because the request actually asks the Responses API for constrained JSON.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
vi.mock("@/lib/routing/local-provider-capacity", () => ({ assertLocalProviderCapacityAvailable: vi.fn() }));

import type { AdapterRequest } from "./adapter-types";
import type { RoutedExecutionPlan } from "./recipe-types";
import { chatAdapter } from "./chat-adapter";
import { openAIAdapter } from "./adapter-openai";

function request(responsePolicy: RoutedExecutionPlan["responsePolicy"]): AdapterRequest {
  return {
    providerId: "chatgpt",
    modelId: "gpt-6.1-terra",
    plan: {
      providerId: "chatgpt",
      modelId: "gpt-6.1-terra",
      recipeId: null,
      contractFamily: "sync.review",
      executionAdapter: "chat",
      maxTokens: 512,
      providerSettings: {},
      toolPolicy: {},
      responsePolicy,
    },
    provider: { baseUrl: "https://chatgpt.com/backend-api", headers: { "Content-Type": "application/json" } },
    fetchImpl: globalThis.fetch,
    messages: [{ role: "user", content: "Review the change and answer in JSON." }],
    systemPrompt: "You are a reviewer.",
  };
}

describe("ChatGPT strict-schema requests (BI-B76DC66C)", () => {
  const mockFetch = vi.fn();

  beforeEach(() => {
    mockFetch.mockReset();
    mockFetch.mockResolvedValue({
      ok: true,
      status: 200,
      text: async () => [
        'data: {"type":"response.completed","response":{"output":[{"type":"message","content":[{"type":"output_text","text":"{\\"decision\\":\\"pass\\"}"}]}],"usage":{"input_tokens":8,"output_tokens":5}}}',
        "data: [DONE]",
      ].join("\n"),
      headers: new Headers(),
    });
    vi.stubGlobal("fetch", mockFetch);
  });
  afterEach(() => vi.restoreAllMocks());

  it("AC-CSO-1: asks the Responses API for a JSON object when the plan requires a strict schema", async () => {
    await chatAdapter.execute(request({ strictSchema: true }));

    const body = JSON.parse(mockFetch.mock.calls[0][1].body);
    expect(mockFetch.mock.calls[0][0]).toBe("https://chatgpt.com/backend-api/codex/responses");
    expect(body.text).toEqual({ format: { type: "json_object" } });
    // The Chat Completions field is not part of the Responses API.
    expect(body.response_format).toBeUndefined();
  });

  it("AC-CSO-1: sends no output format for an ordinary text turn", async () => {
    await chatAdapter.execute(request({}));

    const body = JSON.parse(mockFetch.mock.calls[0][1].body);
    expect(body.text).toBeUndefined();
  });

  it("AC-CSO-2: a model discovered for the chatgpt provider declares structured output", () => {
    const card = openAIAdapter.extractModelCard("gpt-6.1-terra", {
      id: "gpt-6.1-terra",
      slug: "gpt-6.1-terra",
      source: "chatgpt_backend_discovery",
      discoveredForProvider: "chatgpt",
    });

    expect(card.capabilities.structuredOutput).toBe(true);
  });

  it("AC-CSO-2: codex and plain OpenAI discovery do not gain the capability from this path", () => {
    const codex = openAIAdapter.extractModelCard("gpt-6.1-terra", {
      id: "gpt-6.1-terra",
      source: "chatgpt_backend_discovery",
      discoveredForProvider: "codex",
    });
    const openai = openAIAdapter.extractModelCard("gpt-4o", { id: "gpt-4o", object: "model" });

    expect(codex.capabilities.structuredOutput).toBeNull();
    expect(openai.capabilities.structuredOutput).toBeNull();
  });
});
