import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { AdapterRequest } from "./adapter-types";
import type { RoutedExecutionPlan } from "./recipe-types";
import { chatAdapter } from "./chat-adapter";

const writer = { type: "function", function: { name: "record_review", description: "Record", parameters: {} } };

function plan(providerId: string): RoutedExecutionPlan {
  return {
    providerId,
    modelId: "review-model",
    recipeId: null,
    contractFamily: "sync.review",
    executionAdapter: "chat",
    maxTokens: 512,
    providerSettings: {},
    toolPolicy: { toolChoice: "required" },
    responsePolicy: {},
  };
}

function request(providerId: string, baseUrl: string): AdapterRequest {
  return {
    providerId,
    modelId: "review-model",
    plan: plan(providerId),
    provider: { baseUrl, headers: { "Content-Type": "application/json" } },
    fetchImpl: globalThis.fetch,
    messages: [{ role: "user", content: "Record the assessment." }],
    systemPrompt: "Use the governed writer.",
    tools: [writer],
  };
}

describe("chat adapter required tool choice", () => {
  const mockFetch = vi.fn();

  beforeEach(() => {
    mockFetch.mockReset();
    vi.stubGlobal("fetch", mockFetch);
  });
  afterEach(() => vi.restoreAllMocks());

  it("requires the sole writer for OpenAI-compatible/Qwen requests", async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ choices: [{ message: { tool_calls: [] } }], usage: {} }),
      headers: new Headers(),
    });

    await chatAdapter.execute(request("local", "http://localhost:11434"));

    const body = JSON.parse(mockFetch.mock.calls[0][1].body);
    expect(body.tool_choice).toBe("required");
    expect(body.tools).toHaveLength(1);
    expect(body.tools[0].function.name).toBe("record_review");
  });

  it("uses Gemini ANY mode with only the governed writer allowed", async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ candidates: [{ content: { parts: [] } }], usageMetadata: {} }),
      headers: new Headers(),
    });

    await chatAdapter.execute(request("gemini", "https://generativelanguage.googleapis.com/v1beta"));

    const body = JSON.parse(mockFetch.mock.calls[0][1].body);
    expect(body.toolConfig).toEqual({
      functionCallingConfig: { mode: "ANY", allowedFunctionNames: ["record_review"] },
    });
    expect(body.tools[0].functionDeclarations).toHaveLength(1);
  });

  it("sends the immutable reader result and native call signature to the next Gemini step", async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true, headers: new Headers(),
      json: async () => ({ candidates: [{ content: { parts: [{
        functionCall: { id: "source-call", name: "read_source_at_version", args: { version: "immutable-sha" } },
        thoughtSignature: "opaque-native-signature",
      }] } }], usageMetadata: {} }),
    }).mockResolvedValueOnce({
      ok: true, headers: new Headers(),
      json: async () => ({ candidates: [{ content: { parts: [] } }], usageMetadata: {} }),
    });
    const first = await chatAdapter.execute(request("gemini", "https://generativelanguage.googleapis.com/v1beta"));
    const next = request("gemini", "https://generativelanguage.googleapis.com/v1beta");
    next.messages = [
      { role: "user", content: "Read the bound source and record the review." },
      { role: "assistant", content: "", toolCalls: first.toolCalls },
      { role: "tool", toolCallId: first.toolCalls[0]!.id, content: JSON.stringify({ success: true, data: { version: "immutable-sha", content: "The operation must survive restart." } }) },
    ];
    await chatAdapter.execute(next);
    const body = JSON.parse(mockFetch.mock.calls[1][1].body);
    expect(body.contents).toContainEqual({ role: "model", parts: [{
      functionCall: { id: "source-call", name: "read_source_at_version", args: { version: "immutable-sha" } },
      thoughtSignature: "opaque-native-signature",
    }] });
    expect(body.contents).toContainEqual({ role: "user", parts: [{ functionResponse: {
      id: "source-call", name: "read_source_at_version",
      response: { success: true, data: { version: "immutable-sha", content: "The operation must survive restart." } },
    } }] });
    expect(body.toolConfig.functionCallingConfig.mode).toBe("ANY");
  });

  it("uses Anthropic any mode with only the governed writer allowed", async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ content: [], usage: {} }),
      headers: new Headers(),
    });

    await chatAdapter.execute(request("anthropic", "https://api.anthropic.com/v1"));

    const body = JSON.parse(mockFetch.mock.calls[0][1].body);
    expect(body.tool_choice).toEqual({ type: "any" });
    expect(body.tools).toHaveLength(1);
    expect(body.tools[0].name).toBe("record_review");
  });
});
