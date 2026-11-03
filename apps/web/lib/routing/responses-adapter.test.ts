import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";

const aiInferenceFake = vi.hoisted(() => {
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

  function formatMessageForResponses(msg: ChatMessage) {
    if (msg.role === "tool" && msg.toolCallId) {
      return [{ type: "function_call_output", call_id: msg.toolCallId, output: msg.content }];
    }
    if (msg.role === "assistant" && msg.toolCalls && msg.toolCalls.length > 0) {
      return [
        ...(msg.content ? [{ role: "assistant", content: msg.content }] : []),
        ...msg.toolCalls.map((tc) => ({
          type: "function_call",
          call_id: tc.id,
          name: tc.name,
          arguments: JSON.stringify(tc.arguments),
        })),
      ];
    }
    return [{ role: msg.role, content: msg.content }];
  }

  return {
    InferenceError,
    classifyHttpError,
    formatMessageForResponses,
  };
});
vi.mock("@/lib/routing/inference-error", () => aiInferenceFake);
vi.mock("@/lib/routing/provider-message-format", () => aiInferenceFake);

import type { AdapterRequest } from "./adapter-types";
import type { RoutedExecutionPlan } from "./recipe-types";
import { responsesAdapter } from "./responses-adapter";

function makePlan(overrides: Partial<RoutedExecutionPlan> = {}): RoutedExecutionPlan {
  return {
    providerId: "codex",
    modelId: "gpt-5.3-codex",
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
    modelId: "gpt-5.3-codex",
    plan: makePlan(),
    provider: {
      baseUrl: "https://api.openai.com/v1",
      headers: { Authorization: "Bearer test", "Content-Type": "application/json" },
    },
    fetchImpl: globalThis.fetch,
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

function stubFetchText(body: string) {
  mockFetch.mockResolvedValueOnce({
    ok: true,
    status: 200,
    text: async () => body,
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

  it("preserves a required subscription calibration output cap without an unconstrained retry", async () => {
    mockFetch.mockResolvedValueOnce(new Response('{"detail":"Unsupported parameter: max_output_tokens"}', { status: 400 }));
    const request = makeRequest({ providerId: "chatgpt",
      provider: { baseUrl: "https://chatgpt.com/backend-api", headers: {} },
      plan: makePlan({ maxTokens: 32, responsePolicy: { requireOutputBound: true } }) });
    await expect(responsesAdapter.execute(request)).rejects.toMatchObject({ statusCode: 400 });
    expect(JSON.parse(mockFetch.mock.calls[0][1].body)).toHaveProperty("max_output_tokens", 32);
    expect(mockFetch).toHaveBeenCalledTimes(1);
  });

  it.each([undefined, 0, -1, Infinity, NaN])("refuses an invalid mandatory output allowance before dispatch (%s)", async maxTokens => {
    stubFetchText('data: {"type":"response.completed","response":{"status":"completed","output_text":"OK","usage":{"input_tokens":1,"output_tokens":1}}}\n\ndata: [DONE]\n');
    const request = makeRequest({ providerId: "chatgpt",
      provider: { baseUrl: "https://chatgpt.com/backend-api", headers: {} },
      plan: makePlan({ providerId: "chatgpt", maxTokens, responsePolicy: { requireOutputBound: true } }) });
    await expect(responsesAdapter.execute(request)).rejects.toThrow(/output.*(bound|limit|allowance)/i);
    expect(mockFetch).not.toHaveBeenCalled();
  });

  it.each([
    ["response.completed", "completed", undefined, "completed", false],
    ["response.incomplete", "incomplete", "max_output_tokens", "max_output_tokens", true],
    ["response.failed", "failed", undefined, "failed", false],
  ] as const)("preserves actual subscription terminal evidence (%s)", async (type, status, reason, finishReason, truncated) => {
    stubFetchText(`data: ${JSON.stringify({ type, response: { id: "resp-terminal-fixture", status,
      ...(reason ? { incomplete_details: { reason } } : {}),
      output: [{ type: "message", content: [{ type: "output_text", text: "partial or complete" }] }],
      usage: { input_tokens: 4, output_tokens: 8 } } })}\n\ndata: [DONE]\n`);
    const result = await responsesAdapter.execute(makeRequest({ providerId: "chatgpt",
      provider: { baseUrl: "https://chatgpt.com/backend-api", headers: {} } }));
    expect(result).toMatchObject({ responseId: "resp-terminal-fixture", finishReason, truncated,
      usage: { inputTokens: 4, outputTokens: 8 }, raw: { status } });
  });

  it.each([
    [{ type: "response.incomplete", response: { id: "r1", status: "completed" } }],
    [{ type: "response.completed", response: { id: "r1", status: "incomplete", incomplete_details: { reason: "max_output_tokens" } } }],
    [{ type: "response.completed", response: { id: "r1", status: "completed", incomplete_details: { reason: "max_output_tokens" } } }],
    [{ type: "response.completed", response: { id: "r1", status: "completed" } }, { type: "response.completed", response: { id: "r2", status: "completed" } }],
    [{ type: "response.incomplete", response: { id: "r1", status: "incomplete", incomplete_details: { reason: "max_output_tokens" } } }, { type: "response.completed", response: { id: "r1", status: "completed" } }],
    [{ type: "response.created", response: { id: "other" } }, { type: "response.completed", response: { id: "r1", status: "completed" } }],
    [{ type: "response.completed", response: { id: "r1", status: "completed" } }, { type: "response.completed", response: { id: "r1", status: "completed", usage: { output_tokens: 99 } } }],
  ])("leaves contradictory terminal evidence unverified (%j)", async (...events) => {
    stubFetchText(events.map(event => `data: ${JSON.stringify({ ...event, response: {
      output: [{ type: "message", content: [{ type: "output_text", text: "matching answer" }] }],
      usage: { input_tokens: 4, output_tokens: 8 }, ...event.response } })}`).join("\n") + "\ndata: [DONE]\n");
    const result = await responsesAdapter.execute(makeRequest({ providerId: "chatgpt",
      provider: { baseUrl: "https://chatgpt.com/backend-api", headers: {} } }));
    expect(result.finishReason).toBeUndefined();
    expect(result.truncated).toBeUndefined();
  });

  it.each(["malformed", "header-conflict", "missing-terminal-payload", "late-delta"])("does not certify a %s stream", async kind => {
    const terminal = 'data: {"type":"response.completed","response":{"id":"r1","status":"completed","output_text":"answer","usage":{"output_tokens":8}}}\n\n';
    const stream = kind === "malformed" ? 'data: {broken\n\n' + terminal
      : kind === "header-conflict" ? 'event: response.incomplete\n' + terminal
      : kind === "missing-terminal-payload" ? 'data: {"type":"response.completed"}\n\n' + terminal
      : terminal + 'data: {"type":"response.output_text.delta","delta":"extra"}\n\n';
    stubFetchText(stream + "data: [DONE]\n");
    const result = await responsesAdapter.execute(makeRequest({ providerId: "chatgpt", provider: { baseUrl: "https://chatgpt.com/backend-api", headers: {} } }));
    expect(result.finishReason).toBeUndefined(); expect(result.truncated).toBeUndefined();
  });

  it("accepts consistent repeated terminal evidence and CRLF without inventing missing metadata", async () => {
    const terminal = { type: "response.completed", response: { id: "r1", output_text: "answer", usage: { input_tokens: 1, output_tokens: 8 } } };
    stubFetchText([`event: response.completed\r\ndata: ${JSON.stringify(terminal)}`, `event: response.completed\r\ndata: ${JSON.stringify(terminal)}`, "data: [DONE]"].join("\r\n\r\n") + "\r\n");
    const result = await responsesAdapter.execute(makeRequest({ providerId: "chatgpt", provider: { baseUrl: "https://chatgpt.com/backend-api", headers: {} } }));
    expect(result).toMatchObject({ finishReason: "completed", truncated: false, responseId: "r1", usage: { outputTokens: 8 } });
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
    expect(sentBody.model).toBe("gpt-5.3-codex");
    expect(sentBody.store).toBe(false);
    expect(sentBody.instructions).toBe("You are helpful.");
    expect(sentBody.input).toEqual([{ role: "user", content: "Write a helper" }]);
    expect(result.text).toBe("Done.");
    expect(result.usage).toEqual({ inputTokens: 10, outputTokens: 5 });
  });

  it("requires a tool call when the caller-owned plan requires one", async () => {
    stubFetchOk({
      output: [{ type: "function_call", call_id: "writer-1", name: "record_review", arguments: "{}" }],
      usage: { input_tokens: 10, output_tokens: 5 },
    });

    await responsesAdapter.execute(makeRequest({
      plan: makePlan({ toolPolicy: { toolChoice: "required" } }),
      tools: [{ type: "function", function: { name: "record_review", parameters: {} } }],
    }));

    const sentBody = JSON.parse(mockFetch.mock.calls[0][1].body);
    expect(sentBody.tool_choice).toBe("required");
    expect(sentBody.tools).toEqual([{ type: "function", name: "record_review", parameters: {} }]);
  });

  it("uses the ChatGPT backend responses path for codex OAuth providers", async () => {
    stubFetchText([
      'data: {"type":"response.completed","response":{"output":[{"type":"message","content":[{"type":"output_text","text":"OAuth OK."}]}],"usage":{"input_tokens":4,"output_tokens":2}}}',
      "data: [DONE]",
    ].join("\n"));

    const result = await responsesAdapter.execute(
      makeRequest({
        providerId: "codex",
        provider: {
          baseUrl: "https://chatgpt.com/backend-api",
          headers: { Authorization: "Bearer test", "Content-Type": "application/json" },
        },
      }),
    );

    const [url, fetchOpts] = mockFetch.mock.calls[0];
    expect(url).toBe("https://chatgpt.com/backend-api/codex/responses");
    const sentBody = JSON.parse(fetchOpts.body);
    expect(sentBody.stream).toBe(true);
    expect(sentBody.max_output_tokens).toBeUndefined();
    expect(result.text).toBe("OAuth OK.");
  });

  it("omits temperature on the ChatGPT backend, whose reasoning models reject it", async () => {
    stubFetchText([
      'data: {"type":"response.completed","response":{"output":[{"type":"message","content":[{"type":"output_text","text":"ok"}]}],"usage":{"input_tokens":1,"output_tokens":1}}}',
      "data: [DONE]",
    ].join("\n"));

    await responsesAdapter.execute(
      makeRequest({
        providerId: "chatgpt",
        modelId: "gpt-5.6-terra",
        provider: {
          baseUrl: "https://chatgpt.com/backend-api",
          headers: { Authorization: "Bearer test", "Content-Type": "application/json" },
        },
        plan: { ...makeRequest().plan, temperature: 0.2 },
      }),
    );

    const sentBody = JSON.parse(mockFetch.mock.calls[0][1].body);
    expect(sentBody.temperature).toBeUndefined();
  });

  it("retries once without a parameter the provider names as unsupported", async () => {
    mockFetch
      .mockResolvedValueOnce(new Response('{"detail":"Unsupported parameter: temperature"}', { status: 400 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({
        output: [{ type: "message", content: [{ type: "output_text", text: "Done." }] }],
        usage: { input_tokens: 1, output_tokens: 1 },
      }), { status: 200, headers: { "content-type": "application/json" } }));

    const result = await responsesAdapter.execute(
      makeRequest({ plan: { ...makeRequest().plan, temperature: 0.2 } }),
    );

    expect(mockFetch).toHaveBeenCalledTimes(2);
    expect(JSON.parse(mockFetch.mock.calls[0][1].body).temperature).toBe(0.2);
    expect(JSON.parse(mockFetch.mock.calls[1][1].body).temperature).toBeUndefined();
    expect(result.text).toBe("Done.");
  });

  it.each([
    "tools", "tool_choice", "instructions", "input", "model", "store",
    "max_output_tokens", "reasoning", "previous_response_id",
  ])("does not narrow the request contract after unsupported %s", async (parameter) => {
    mockFetch
      .mockResolvedValueOnce(new Response(JSON.stringify({ detail: `Unsupported parameter: ${parameter}` }), { status: 400 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({
        output: [{ type: "message", content: [{ type: "output_text", text: "Synthetic text-only response." }] }],
      }), { status: 200, headers: { "content-type": "application/json" } }));
    const outcome = await responsesAdapter.execute(makeRequest({
      plan: makePlan({ toolPolicy: { toolChoice: "required" } }),
      previousResponseId: parameter === "previous_response_id" ? "resp_synthetic_prior" : undefined,
      tools: [{ type: "function", function: { name: "read_synthetic_value", parameters: { type: "object", properties: {} } } }],
    })).then(() => ({ rejected: false }), (error: unknown) => ({ rejected: true, error }));

    expect(JSON.parse(mockFetch.mock.calls[0][1].body)).toHaveProperty(parameter);
    expect(outcome).toMatchObject({ rejected: true, error: { code: "provider_error", statusCode: 400 } });
    expect(mockFetch).toHaveBeenCalledTimes(1);
  });

  it("retains tools and instructions during the optional temperature retry", async () => {
    mockFetch
      .mockResolvedValueOnce(new Response('{"detail":"Unsupported parameter: temperature"}', { status: 400 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({
        output: [{ type: "function_call", call_id: "synthetic-call", name: "read_synthetic_value", arguments: "{}" }],
      }), { status: 200, headers: { "content-type": "application/json" } }));
    const result = await responsesAdapter.execute(makeRequest({
      plan: makePlan({ temperature: 0.2, toolPolicy: { toolChoice: "required" } }),
      tools: [{ type: "function", function: { name: "read_synthetic_value", parameters: { type: "object", properties: {} } } }],
    }));

    expect(mockFetch).toHaveBeenCalledTimes(2);
    const first = JSON.parse(mockFetch.mock.calls[0][1].body);
    const second = JSON.parse(mockFetch.mock.calls[1][1].body);
    expect(first.temperature).toBe(0.2);
    expect(second).not.toHaveProperty("temperature");
    const expected = { ...first };
    delete expected.temperature;
    expect(second).toEqual(expected);
    expect(result.toolCalls).toMatchObject([{ name: "read_synthetic_value", arguments: {} }]);
  });

  it("uses the ChatGPT backend responses path for chatgpt subscription providers", async () => {
    stubFetchText([
      'data: {"type":"response.completed","response":{"output":[{"type":"message","content":[{"type":"output_text","text":"Subscription OK."}]}],"usage":{"input_tokens":3,"output_tokens":2}}}',
      "data: [DONE]",
    ].join("\n"));

    const result = await responsesAdapter.execute(
      makeRequest({
        providerId: "chatgpt",
        modelId: "gpt-5.4",
        provider: {
          baseUrl: "https://chatgpt.com/backend-api",
          headers: { Authorization: "Bearer test", "Content-Type": "application/json" },
        },
      }),
    );

    const [url, fetchOpts] = mockFetch.mock.calls[0];
    expect(url).toBe("https://chatgpt.com/backend-api/codex/responses");
    const sentBody = JSON.parse(fetchOpts.body);
    expect(sentBody.stream).toBe(true);
    expect(sentBody.max_output_tokens).toBeUndefined();
    expect(result.text).toBe("Subscription OK.");
    expect(result.usage).toEqual({ inputTokens: 3, outputTokens: 2 });
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

  it("formats tool history using Responses input items instead of nested tool_calls", async () => {
    stubFetchOk({
      output: [
        { type: "message", content: [{ type: "output_text", text: "Done." }] },
      ],
      usage: { input_tokens: 14, output_tokens: 7 },
    });

    await responsesAdapter.execute(
      makeRequest({
        tools: [{ type: "function", function: { name: "search_project_files", description: "Search files", parameters: {} } }],
        messages: [
          { role: "user", content: "Find the customer complaint tracker files." },
          {
            role: "assistant",
            content: "Searching the repo.",
            toolCalls: [{ id: "call_search_1", name: "search_project_files", arguments: { query: "customer complaint tracker" } }],
          },
          { role: "tool", content: "[\"app/complaints/page.tsx\"]", toolCallId: "call_search_1" },
          { role: "user", content: "Summarize what you found." },
        ],
      }),
    );

    const sentBody = JSON.parse(mockFetch.mock.calls[0][1].body);
    expect(sentBody.input).toEqual([
      { role: "user", content: "Find the customer complaint tracker files." },
      { role: "assistant", content: "Searching the repo." },
      {
        type: "function_call",
        call_id: "call_search_1",
        name: "search_project_files",
        arguments: "{\"query\":\"customer complaint tracker\"}",
      },
      {
        type: "function_call_output",
        call_id: "call_search_1",
        output: "[\"app/complaints/page.tsx\"]",
      },
      { role: "user", content: "Summarize what you found." },
    ]);
  });

  it("accepts plain text content parts from responses backends", async () => {
    stubFetchText([
      'data: {"type":"response.completed","response":{"output":[{"type":"message","content":[{"type":"text","text":"Plain text works."}]}],"usage":{"input_tokens":6,"output_tokens":4}}}',
      "data: [DONE]",
    ].join("\n"));

    const result = await responsesAdapter.execute(
      makeRequest({
        providerId: "chatgpt",
        modelId: "gpt-5.4",
        provider: {
          baseUrl: "https://chatgpt.com/backend-api",
          headers: { Authorization: "Bearer test", "Content-Type": "application/json" },
        },
      }),
    );

    expect(result.text).toBe("Plain text works.");
    expect(result.usage).toEqual({ inputTokens: 6, outputTokens: 4 });
  });
});
