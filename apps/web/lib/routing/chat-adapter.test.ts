import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";

// ── Mocks (must be declared before imports) ──────────────────────────────────

// Mock ai-inference: provide real pure functions but avoid DB imports
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

  type ContentBlock = { type?: string; id?: string; name?: string; input?: Record<string, unknown> };
  type ChatMessage = { role: string; content: string | ContentBlock[]; toolCalls?: Array<{ id: string; name: string; arguments: Record<string, unknown> }>; toolCallId?: string };

  function extractAnthropicToolCalls(
    contentBlocks: ContentBlock[],
  ) {
    return contentBlocks
      .filter((b) => b.type === "tool_use" && b.name)
      .map((b) => ({
        id: b.id ?? `synth_${Math.random().toString(36).slice(2, 9)}`,
        name: b.name!,
        arguments: b.input ?? {},
      }));
  }

  function extractOpenAIToolCalls(
    rawToolCalls: Array<{ id?: string; function?: { name?: string; arguments?: string } }>,
  ) {
    return rawToolCalls
      .filter((tc) => tc.function?.name)
      .map((tc) => ({
        id: tc.id ?? `synth_${Math.random().toString(36).slice(2, 9)}`,
        name: tc.function!.name!,
        arguments: tc.function?.arguments ? JSON.parse(tc.function.arguments) : {},
      }));
  }

  function formatMessageForAnthropic(msg: ChatMessage) {
    if (msg.role === "tool" && msg.toolCallId) {
      return { role: "user", content: [{ type: "tool_result", tool_use_id: msg.toolCallId, content: typeof msg.content === "string" ? msg.content : "" }] };
    }
    if (msg.role === "assistant" && msg.toolCalls && msg.toolCalls.length > 0) {
      const textContent = typeof msg.content === "string" ? msg.content : "";
      return {
        role: "assistant",
        content: [
          ...(textContent ? [{ type: "text" as const, text: textContent }] : []),
          ...msg.toolCalls.map((tc: { id: string; name: string; arguments: Record<string, unknown> }) => ({ type: "tool_use" as const, id: tc.id, name: tc.name, input: tc.arguments })),
        ],
      };
    }
    return { role: msg.role, content: typeof msg.content === "string" ? msg.content : JSON.stringify(msg.content) };
  }

  function formatMessageForOpenAI(msg: ChatMessage) {
    if (msg.role === "tool" && msg.toolCallId) {
      return { role: "tool", tool_call_id: msg.toolCallId, content: typeof msg.content === "string" ? msg.content : "" };
    }
    if (msg.role === "assistant" && msg.toolCalls && msg.toolCalls.length > 0) {
      return {
        role: "assistant",
        content: typeof msg.content === "string" ? msg.content : "",
        tool_calls: msg.toolCalls.map((tc: { id: string; name: string; arguments: Record<string, unknown> }) => ({
          id: tc.id, type: "function",
          function: { name: tc.name, arguments: JSON.stringify(tc.arguments) },
        })),
      };
    }
    return { role: msg.role, content: typeof msg.content === "string" ? msg.content : JSON.stringify(msg.content) };
  }

  function formatMessageForResponses(msg: ChatMessage) {
    const textContent = typeof msg.content === "string" ? msg.content : JSON.stringify(msg.content);
    if (msg.role === "tool" && msg.toolCallId) {
      return [{ type: "function_call_output", call_id: msg.toolCallId, output: textContent }];
    }
    if (msg.role === "assistant" && msg.toolCalls && msg.toolCalls.length > 0) {
      return [
        ...(textContent ? [{ role: "assistant", content: textContent }] : []),
        ...msg.toolCalls.map((tc: { id: string; name: string; arguments: Record<string, unknown> }) => ({
          type: "function_call",
          call_id: tc.id,
          name: tc.name,
          arguments: JSON.stringify(tc.arguments),
        })),
      ];
    }
    return [{ role: msg.role, content: textContent }];
  }

  return {
    InferenceError,
    classifyHttpError,
    extractAnthropicToolCalls,
    extractOpenAIToolCalls,
    formatMessageForAnthropic,
    formatMessageForOpenAI,
    formatMessageForResponses,
  };
});

// ── Imports (after mocks) ────────────────────────────────────────────────────

import type { AdapterRequest } from "./adapter-types";
import type { RoutedExecutionPlan } from "./recipe-types";
import { chatAdapter } from "./chat-adapter";
import { InferenceError } from "@/lib/ai-inference";

// ─── Helpers ──────────────────────────────────────────────────────────────────

function makePlan(overrides: Partial<RoutedExecutionPlan> = {}): RoutedExecutionPlan {
  return {
    providerId: "ollama",
    modelId: "llama3.1",
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
    providerId: "ollama",
    modelId: "llama3.1",
    plan: makePlan(),
    provider: {
      baseUrl: "http://localhost:11434",
      headers: { "Content-Type": "application/json" },
    },
    messages: [{ role: "user", content: "Hello" }],
    systemPrompt: "You are helpful.",
    ...overrides,
  };
}

// ─── Mock fetch ────────────────────────────────────────────────────────────────

let mockFetch: ReturnType<typeof vi.fn>;

function stubFetchOk(body: Record<string, unknown>) {
  mockFetch.mockResolvedValueOnce({
    ok: true,
    status: 200,
    json: async () => body,
    headers: new Headers(),
  });
}

function stubFetchError(status: number, body = "") {
  mockFetch.mockResolvedValueOnce({
    ok: false,
    status,
    text: async () => body,
    headers: new Headers(),
  });
}

function stubFetchNetworkError(message: string) {
  mockFetch.mockRejectedValueOnce(new Error(message));
}

// ─── Tests ─────────────────────────────────────────────────────────────────────

describe("chatAdapter", () => {
  beforeEach(() => {
    mockFetch = vi.fn();
    vi.stubGlobal("fetch", mockFetch);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  // ── 1. OpenAI-compatible: correct URL, body shape, max_tokens, temperature ──

  it("OpenAI-compat: correct URL, body shape, max_tokens from plan, temperature", async () => {
    stubFetchOk({
      choices: [{ message: { content: "Hi there" } }],
      usage: { prompt_tokens: 10, completion_tokens: 5 },
    });

    const req = makeRequest({
      providerId: "ollama",
      modelId: "llama3.1",
      plan: makePlan({ maxTokens: 1024, temperature: 0.7 }),
      provider: { baseUrl: "http://localhost:11434", headers: { "Content-Type": "application/json" } },
    });

    const result = await chatAdapter.execute(req);

    // Verify URL
    const [url, fetchOpts] = mockFetch.mock.calls[0];
    expect(url).toBe("http://localhost:11434/v1/chat/completions");

    // Verify body
    const sentBody = JSON.parse(fetchOpts.body);
    expect(sentBody.model).toBe("llama3.1");
    expect(sentBody.max_tokens).toBe(1024);
    expect(sentBody.temperature).toBe(0.7);
    expect(sentBody.keep_alive).toBe(-1);
    // System prompt prepended to messages
    expect(sentBody.messages[0]).toEqual({ role: "system", content: "You are helpful." });
    expect(sentBody.messages[1]).toEqual({ role: "user", content: "Hello" });

    // Verify result
    expect(result.text).toBe("Hi there");
    expect(result.usage.inputTokens).toBe(10);
    expect(result.usage.outputTokens).toBe(5);
    expect(result.toolCalls).toEqual([]);
  });

  // ── 2. OpenAI-compat: reasoning_effort from providerSettings ──

  it("OpenAI-compat: reasoning_effort from providerSettings", async () => {
    stubFetchOk({
      choices: [{ message: { content: "answer" } }],
      usage: { prompt_tokens: 5, completion_tokens: 3 },
    });

    const req = makeRequest({
      providerId: "openai",
      modelId: "o3-mini",
      plan: makePlan({
        providerId: "openai",
        modelId: "o3-mini",
        providerSettings: { reasoning_effort: "medium" },
      }),
      provider: { baseUrl: "https://api.openai.com/v1", headers: { Authorization: "Bearer sk-test" } },
    });

    await chatAdapter.execute(req);

    const sentBody = JSON.parse(mockFetch.mock.calls[0][1].body);
    expect(sentBody.reasoning_effort).toBe("medium");
  });

  // ── 3. Anthropic: correct URL, body shape, system prompt separate ──

  it("Anthropic: correct URL, body shape, system prompt separate", async () => {
    stubFetchOk({
      content: [{ type: "text", text: "Hello from Claude" }],
      usage: { input_tokens: 12, output_tokens: 8 },
    });

    const req = makeRequest({
      providerId: "anthropic",
      modelId: "claude-sonnet-4-20250514",
      plan: makePlan({ providerId: "anthropic", modelId: "claude-sonnet-4-20250514", maxTokens: 4096 }),
      provider: {
        baseUrl: "https://api.anthropic.com/v1",
        headers: { "x-api-key": "sk-ant-test", "anthropic-version": "2023-06-01" },
      },
    });

    const result = await chatAdapter.execute(req);

    const [url, fetchOpts] = mockFetch.mock.calls[0];
    expect(url).toBe("https://api.anthropic.com/v1/messages");

    const sentBody = JSON.parse(fetchOpts.body);
    expect(sentBody.model).toBe("claude-sonnet-4-20250514");
    expect(sentBody.max_tokens).toBe(4096);
    expect(sentBody.system).toBe("You are helpful.");
    // Messages should not include system role
    expect(sentBody.messages.every((m: { role: string }) => m.role !== "system")).toBe(true);

    expect(result.text).toBe("Hello from Claude");
    expect(result.usage.inputTokens).toBe(12);
    expect(result.usage.outputTokens).toBe(8);
  });

  // ── 4. Anthropic: providerTools merged into tools array (computer use) ──

  it("Anthropic: providerTools merged into tools array", async () => {
    stubFetchOk({
      content: [{ type: "text", text: "ok" }],
      usage: { input_tokens: 5, output_tokens: 2 },
    });

    const computerTool = {
      type: "computer_20241022",
      name: "computer",
      display_width_px: 1024,
      display_height_px: 768,
    };

    const req = makeRequest({
      providerId: "anthropic",
      modelId: "claude-sonnet-4-20250514",
      plan: makePlan({
        providerId: "anthropic",
        providerSettings: { providerTools: [computerTool] },
      }),
      provider: {
        baseUrl: "https://api.anthropic.com/v1",
        headers: { "x-api-key": "sk-ant-test" },
      },
      tools: [{ type: "function", function: { name: "search", description: "Search", parameters: {} } }],
    });

    await chatAdapter.execute(req);

    const sentBody = JSON.parse(mockFetch.mock.calls[0][1].body);
    // Should have the converted user tool + the providerTool
    expect(sentBody.tools).toHaveLength(2);
    // The user tool should be converted to Anthropic format
    expect(sentBody.tools[0]).toEqual({ name: "search", description: "Search", input_schema: {} });
    // The provider tool should be appended as-is
    expect(sentBody.tools[1]).toEqual(computerTool);
  });

  // ── 5. Anthropic: thinking config from providerSettings ──

  it("Anthropic: thinking config from providerSettings", async () => {
    stubFetchOk({
      content: [{ type: "text", text: "deep thought" }],
      usage: { input_tokens: 10, output_tokens: 20 },
    });

    const req = makeRequest({
      providerId: "anthropic",
      modelId: "claude-sonnet-4-20250514",
      plan: makePlan({
        providerId: "anthropic",
        providerSettings: { thinking: { type: "enabled", budget_tokens: 10000 } },
      }),
      provider: {
        baseUrl: "https://api.anthropic.com/v1",
        headers: { "x-api-key": "sk-ant-test" },
      },
    });

    await chatAdapter.execute(req);

    const sentBody = JSON.parse(mockFetch.mock.calls[0][1].body);
    expect(sentBody.thinking).toEqual({ type: "enabled", budget_tokens: 10000 });
  });

  // ── 6. Gemini: correct URL, contents format ──

  it("Gemini: correct URL, contents format", async () => {
    stubFetchOk({
      candidates: [{ content: { parts: [{ text: "Gemini response" }] } }],
      usageMetadata: { promptTokenCount: 15, candidatesTokenCount: 10 },
    });

    const req = makeRequest({
      providerId: "gemini",
      modelId: "gemini-2.5-flash",
      plan: makePlan({ providerId: "gemini", modelId: "gemini-2.5-flash", maxTokens: 2048, temperature: 0.5 }),
      provider: {
        baseUrl: "https://generativelanguage.googleapis.com/v1beta",
        headers: { "Content-Type": "application/json" },
      },
    });

    const result = await chatAdapter.execute(req);

    const [url] = mockFetch.mock.calls[0];
    expect(url).toBe("https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent");

    const sentBody = JSON.parse(mockFetch.mock.calls[0][1].body);
    // System prompt should be first user turn followed by model acknowledgment
    expect(sentBody.contents[0]).toEqual({ role: "user", parts: [{ text: "You are helpful." }] });
    expect(sentBody.contents[1]).toEqual({ role: "model", parts: [{ text: "Understood. I will follow these instructions." }] });
    // User message follows
    expect(sentBody.contents[2]).toEqual({ role: "user", parts: [{ text: "Hello" }] });
    // Generation config
    expect(sentBody.generationConfig.maxOutputTokens).toBe(2048);
    expect(sentBody.generationConfig.temperature).toBe(0.5);

    expect(result.text).toBe("Gemini response");
    expect(result.usage.inputTokens).toBe(15);
    expect(result.usage.outputTokens).toBe(10);
  });

  // ── 7. Gemini: providerTools merged into body.tools (code_execution) ──

  it("Gemini: providerTools merged into body.tools", async () => {
    stubFetchOk({
      candidates: [{ content: { parts: [{ text: "code result" }] } }],
      usageMetadata: { promptTokenCount: 5, candidatesTokenCount: 3 },
    });

    const req = makeRequest({
      providerId: "gemini",
      modelId: "gemini-2.5-flash",
      plan: makePlan({
        providerId: "gemini",
        providerSettings: { providerTools: [{ code_execution: {} }] },
      }),
      provider: {
        baseUrl: "https://generativelanguage.googleapis.com/v1beta",
        headers: { "Content-Type": "application/json" },
      },
    });

    await chatAdapter.execute(req);

    const sentBody = JSON.parse(mockFetch.mock.calls[0][1].body);
    expect(sentBody.tools).toEqual([{ code_execution: {} }]);
  });

  // ── 8. Gemini: code_execution response parts extracted as text ──

  it("Gemini: code_execution response parts extracted as text", async () => {
    stubFetchOk({
      candidates: [{
        content: {
          parts: [
            { text: "Let me compute that." },
            { executableCode: { language: "PYTHON", code: "print(2+2)" } },
            { codeExecutionResult: { outcome: "OUTCOME_OK", output: "4" } },
            { text: "The answer is 4." },
          ],
        },
      }],
      usageMetadata: { promptTokenCount: 10, candidatesTokenCount: 20 },
    });

    const req = makeRequest({
      providerId: "gemini",
      modelId: "gemini-2.5-flash",
      plan: makePlan({ providerId: "gemini" }),
      provider: {
        baseUrl: "https://generativelanguage.googleapis.com/v1beta",
        headers: { "Content-Type": "application/json" },
      },
    });

    const result = await chatAdapter.execute(req);

    // All parts should be concatenated into text
    expect(result.text).toContain("Let me compute that.");
    expect(result.text).toContain("print(2+2)");
    expect(result.text).toContain("4");
    expect(result.text).toContain("The answer is 4.");
  });

  // ── 9. Error handling: HTTP 429 → InferenceError with rate_limit ──

  it("HTTP 429 → InferenceError with rate_limit code", async () => {
    stubFetchError(429, "Too many requests");

    const req = makeRequest({ providerId: "ollama" });

    try {
      await chatAdapter.execute(req);
      expect.unreachable("Should have thrown");
    } catch (e) {
      expect(e).toBeInstanceOf(InferenceError);
      expect((e as InferenceError).code).toBe("rate_limit");
    }
  });

  // ── 10. Error handling: network failure → InferenceError with network ──

  it("Network failure → InferenceError with network code", async () => {
    stubFetchNetworkError("ECONNREFUSED");

    const req = makeRequest({ providerId: "ollama" });

    try {
      await chatAdapter.execute(req);
      expect.unreachable("Should have thrown");
    } catch (e) {
      expect(e).toBeInstanceOf(InferenceError);
      expect((e as InferenceError).code).toBe("network");
      expect((e as InferenceError).message).toContain("ECONNREFUSED");
    }
  });

  // ── 11. Backward compat: no providerTools → request unchanged ──

  it("No providerTools → tools not modified in request body", async () => {
    stubFetchOk({
      choices: [{ message: { content: "ok" } }],
      usage: { prompt_tokens: 5, completion_tokens: 2 },
    });

    const req = makeRequest({
      providerId: "ollama",
      plan: makePlan({ providerSettings: {} }),
      tools: [{ type: "function", function: { name: "get_weather", description: "Get weather", parameters: {} } }],
    });

    await chatAdapter.execute(req);

    const sentBody = JSON.parse(mockFetch.mock.calls[0][1].body);
    // Tools should be passed through unchanged (OpenAI format)
    expect(sentBody.tools).toEqual([
      { type: "function", function: { name: "get_weather", description: "Get weather", parameters: {} } },
    ]);
  });

  // ── Gemini: functionCall parts → tool calls ──

  it("Gemini: functionCall parts extracted as tool calls", async () => {
    stubFetchOk({
      candidates: [{
        content: {
          parts: [
            { functionCall: { name: "get_weather", args: { location: "London" } } },
          ],
        },
      }],
      usageMetadata: { promptTokenCount: 10, candidatesTokenCount: 5 },
    });

    const req = makeRequest({
      providerId: "gemini",
      modelId: "gemini-2.5-flash",
      plan: makePlan({ providerId: "gemini" }),
      provider: {
        baseUrl: "https://generativelanguage.googleapis.com/v1beta",
        headers: { "Content-Type": "application/json" },
      },
    });

    const result = await chatAdapter.execute(req);

    expect(result.toolCalls).toHaveLength(1);
    expect(result.toolCalls[0].name).toBe("get_weather");
    expect(result.toolCalls[0].arguments).toEqual({ location: "London" });
    expect(result.toolCalls[0].id).toBeDefined();
  });

  // ── OpenAI-compat: baseUrl already ending in /v1 ──

  it("OpenAI-compat: baseUrl ending in /v1 does not double up", async () => {
    stubFetchOk({
      choices: [{ message: { content: "ok" } }],
      usage: { prompt_tokens: 2, completion_tokens: 1 },
    });

    const req = makeRequest({
      providerId: "openai",
      provider: { baseUrl: "https://api.openai.com/v1", headers: { Authorization: "Bearer sk-test" } },
    });

    await chatAdapter.execute(req);

    const [url] = mockFetch.mock.calls[0];
    expect(url).toBe("https://api.openai.com/v1/chat/completions");
  });

  // ── Anthropic tool calls extracted from response ──

  it("Anthropic: tool_use blocks extracted as toolCalls", async () => {
    stubFetchOk({
      content: [
        { type: "text", text: "I'll search for that." },
        { type: "tool_use", id: "toolu_123", name: "search", input: { query: "weather" } },
      ],
      usage: { input_tokens: 10, output_tokens: 15 },
    });

    const req = makeRequest({
      providerId: "anthropic",
      modelId: "claude-sonnet-4-20250514",
      plan: makePlan({ providerId: "anthropic" }),
      provider: {
        baseUrl: "https://api.anthropic.com/v1",
        headers: { "x-api-key": "sk-ant-test" },
      },
    });

    const result = await chatAdapter.execute(req);

    expect(result.text).toBe("I'll search for that.");
    expect(result.toolCalls).toHaveLength(1);
    expect(result.toolCalls[0]).toEqual({ id: "toolu_123", name: "search", arguments: { query: "weather" } });
  });

  // ── OpenAI-compat: tool calls extracted from response ──

  it("OpenAI-compat: tool_calls extracted from response", async () => {
    stubFetchOk({
      choices: [{
        message: {
          content: "Let me check.",
          tool_calls: [
            { id: "call_abc", type: "function", function: { name: "get_weather", arguments: '{"city":"London"}' } },
          ],
        },
      }],
      usage: { prompt_tokens: 10, completion_tokens: 12 },
    });

    const req = makeRequest({
      providerId: "ollama",
      plan: makePlan(),
    });

    const result = await chatAdapter.execute(req);

    expect(result.text).toBe("Let me check.");
    expect(result.toolCalls).toHaveLength(1);
    expect(result.toolCalls[0]).toEqual({ id: "call_abc", name: "get_weather", arguments: { city: "London" } });
  });

  it("ChatGPT: accepts plain text content parts from completed SSE responses", async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      status: 200,
      text: async () => [
        'data: {"type":"response.completed","response":{"output":[{"type":"message","content":[{"type":"text","text":"Subscription fallback works."}]}],"usage":{"input_tokens":8,"output_tokens":5}}}',
        "data: [DONE]",
      ].join("\n"),
      headers: new Headers(),
    });

    const req = makeRequest({
      providerId: "chatgpt",
      modelId: "gpt-5.4",
      plan: makePlan({
        providerId: "chatgpt",
        modelId: "gpt-5.4",
      }),
      provider: {
        baseUrl: "https://chatgpt.com/backend-api",
        headers: { Authorization: "Bearer test", "Content-Type": "application/json" },
      },
    });

    const result = await chatAdapter.execute(req);

    expect(result.text).toBe("Subscription fallback works.");
    expect(result.usage).toEqual({ inputTokens: 8, outputTokens: 5 });
  });

  it("ChatGPT: formats tool history as Responses items instead of nested tool_calls", async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      status: 200,
      text: async () => [
        'data: {"type":"response.completed","response":{"output":[{"type":"message","content":[{"type":"output_text","text":"Done."}]}],"usage":{"input_tokens":12,"output_tokens":4}}}',
        "data: [DONE]",
      ].join("\n"),
      headers: new Headers(),
    });

    await chatAdapter.execute(makeRequest({
      providerId: "chatgpt",
      modelId: "gpt-5.4",
      plan: makePlan({
        providerId: "chatgpt",
        modelId: "gpt-5.4",
      }),
      provider: {
        baseUrl: "https://chatgpt.com/backend-api",
        headers: { Authorization: "Bearer test", "Content-Type": "application/json" },
      },
      messages: [
        { role: "user", content: "Find the complaint tracker." },
        {
          role: "assistant",
          content: "Searching...",
          toolCalls: [{ id: "call_search_1", name: "search_project_files", arguments: { query: "complaint tracker" } }],
        },
        { role: "tool", content: "[\"app/complaints/page.tsx\"]", toolCallId: "call_search_1" },
      ],
    }));

    const sentBody = JSON.parse(mockFetch.mock.calls[0][1].body);
    expect(sentBody.input).toEqual([
      { role: "user", content: "Find the complaint tracker." },
      { role: "assistant", content: "Searching..." },
      {
        type: "function_call",
        call_id: "call_search_1",
        name: "search_project_files",
        arguments: "{\"query\":\"complaint tracker\"}",
      },
      {
        type: "function_call_output",
        call_id: "call_search_1",
        output: "[\"app/complaints/page.tsx\"]",
      },
    ]);
  });

  // ── Adapter type is "chat" ──

  it("adapter type is 'chat'", () => {
    expect(chatAdapter.type).toBe("chat");
  });
});
