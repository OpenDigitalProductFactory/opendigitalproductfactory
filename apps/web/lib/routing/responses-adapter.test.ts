import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";

vi.mock("@/lib/ai-inference", () => {
  class InferenceError extends Error {
    name = "InferenceError";
    constructor(
      message: string,
      public readonly code: "network" | "auth" | "rate_limit" | "model_not_found" | "provider_error",
      public readonly providerId: string,
      public readonly statusCode?: number,
      public readonly headers?: Record<string, string>,
    ) {
      super(message);
    }
  }

  function classifyHttpError(
    status: number,
    providerId: string,
    body: string,
    responseHeaders?: Headers,
  ): InferenceError {
    const rateLimitHeaders: Record<string, string> | undefined = responseHeaders
      ? Object.fromEntries(
          [...responseHeaders.entries()].filter(
            ([k]) =>
              k.startsWith("x-ratelimit") ||
              k.startsWith("anthropic-ratelimit") ||
              k === "retry-after",
          ),
        )
      : undefined;
    const headers = rateLimitHeaders && Object.keys(rateLimitHeaders).length > 0
      ? rateLimitHeaders
      : undefined;
    if (status === 401 || status === 403) {
      return new InferenceError(`Auth failed for ${providerId}: ${body.slice(0, 200)}`, "auth", providerId, status, headers);
    }
    if (status === 429) {
      return new InferenceError(`Rate limited by ${providerId}`, "rate_limit", providerId, status, headers);
    }
    if (status === 404) {
      return new InferenceError(`Model not found on ${providerId}: ${body.slice(0, 200)}`, "model_not_found", providerId, status, headers);
    }
    return new InferenceError(`HTTP ${status} from ${providerId}: ${body.slice(0, 300)}`, "provider_error", providerId, status, headers);
  }

  type ChatMessage = {
    role: string;
    content: string;
    toolCalls?: Array<{ id: string; name: string; arguments: Record<string, unknown> }>;
    toolCallId?: string;
  };

  function formatMessageForOpenAI(msg: ChatMessage) {
    if (msg.role === "tool" && msg.toolCallId) {
      return { role: "tool", tool_call_id: msg.toolCallId, content: msg.content };
    }
    if (msg.role === "assistant" && msg.toolCalls && msg.toolCalls.length > 0) {
      return {
        role: "assistant",
        content: msg.content,
        tool_calls: msg.toolCalls.map((tc) => ({
          id: tc.id,
          type: "function",
          function: { name: tc.name, arguments: JSON.stringify(tc.arguments) },
        })),
      };
    }
    return { role: msg.role, content: msg.content };
  }

  return {
    InferenceError,
    classifyHttpError,
    formatMessageForOpenAI,
  };
});

import type { AdapterRequest } from "./adapter-types";
import type { RoutedExecutionPlan } from "./recipe-types";
import { responsesAdapter } from "./responses-adapter";

function makePlan(overrides: Partial<RoutedExecutionPlan> = {}): RoutedExecutionPlan {
  return {
    providerId: "codex",
    modelId: "gpt-5-codex",
    recipeId: null,
    contractFamily: "sync.code-gen",
    executionAdapter: "responses",
    maxTokens: 2048,
    providerSettings: {},
    toolPolicy: {},
    responsePolicy: {},
    ...overrides,
  };
}

function makeRequest(overrides: Partial<AdapterRequest> = {}): AdapterRequest {
  return {
    providerId: "codex",
    modelId: "gpt-5-codex",
    plan: makePlan(),
    provider: {
      baseUrl: "https://api.openai.com/v1",
      headers: { Authorization: "Bearer test", "Content-Type": "application/json" },
    },
    messages: [{ role: "user", content: "Write a helper" }],
    systemPrompt: "You are helpful.",
    ...overrides,
  };
}

let mockFetch: ReturnType<typeof vi.fn>;

function stubFetchOk(body: Record<string, unknown>) {
  mockFetch.mockResolvedValueOnce({
    ok: true,
    status: 200,
    json: async () => body,
    headers: new Headers(),
  });
}

describe("responsesAdapter", () => {
  beforeEach(() => {
    mockFetch = vi.fn();
    vi.stubGlobal("fetch", mockFetch);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("uses the OpenAI Responses API for codex providers", async () => {
    stubFetchOk({
      output: [
        { type: "message", content: [{ type: "output_text", text: "Done." }] },
      ],
      usage: { input_tokens: 10, output_tokens: 5 },
    });

    const result = await responsesAdapter.execute(makeRequest());

    const [url, fetchOpts] = mockFetch.mock.calls[0];
    expect(url).toBe("https://api.openai.com/v1/responses");

    const sentBody = JSON.parse(fetchOpts.body);
    expect(sentBody.model).toBe("gpt-5-codex");
    expect(sentBody.store).toBe(false);
    expect(sentBody.instructions).toBe("You are helpful.");
    expect(sentBody.input).toEqual([{ role: "user", content: "Write a helper" }]);
    expect(result.text).toBe("Done.");
    expect(result.usage).toEqual({ inputTokens: 10, outputTokens: 5 });
  });

  it("uses the ChatGPT backend responses path for codex OAuth providers", async () => {
    stubFetchOk({
      output: [
        { type: "message", content: [{ type: "output_text", text: "OAuth OK." }] },
      ],
      usage: { input_tokens: 4, output_tokens: 2 },
    });

    await responsesAdapter.execute(
      makeRequest({
        providerId: "codex",
        provider: {
          baseUrl: "https://chatgpt.com/backend-api",
          headers: { Authorization: "Bearer test", "Content-Type": "application/json" },
        },
      }),
    );

    const [url] = mockFetch.mock.calls[0];
    expect(url).toBe("https://chatgpt.com/backend-api/codex/responses");
  });

  it("uses the ChatGPT backend responses path for chatgpt subscription providers", async () => {
    stubFetchOk({
      output: [
        { type: "message", content: [{ type: "output_text", text: "Subscription OK." }] },
      ],
      usage: { input_tokens: 3, output_tokens: 2 },
    });

    await responsesAdapter.execute(
      makeRequest({
        providerId: "chatgpt",
        modelId: "gpt-5.4",
        provider: {
          baseUrl: "https://chatgpt.com/backend-api",
          headers: { Authorization: "Bearer test", "Content-Type": "application/json" },
        },
      }),
    );

    const [url] = mockFetch.mock.calls[0];
    expect(url).toBe("https://chatgpt.com/backend-api/codex/responses");
  });

  it("extracts function_call output items as tool calls", async () => {
    stubFetchOk({
      output: [
        { type: "message", content: [{ type: "output_text", text: "Checking..." }] },
        {
          type: "function_call",
          call_id: "call_123",
          name: "read_file",
          arguments: "{\"path\":\"README.md\"}",
        },
      ],
      usage: { input_tokens: 9, output_tokens: 4 },
    });

    const result = await responsesAdapter.execute(
      makeRequest({
        tools: [{ type: "function", function: { name: "read_file", description: "Read a file", parameters: {} } }],
      }),
    );

    expect(result.text).toBe("Checking...");
    expect(result.toolCalls).toEqual([
      { id: "call_123", name: "read_file", arguments: { path: "README.md" } },
    ]);
  });
});
