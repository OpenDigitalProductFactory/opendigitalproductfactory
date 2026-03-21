import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";

// ── Mocks ────────────────────────────────────────────────────────────────────

vi.mock("@/lib/ai-inference", () => {
  class InferenceError extends Error {
    name = "InferenceError";
    constructor(
      message: string,
      public readonly code: string,
      public readonly providerId: string,
    ) {
      super(message);
    }
  }

  function classifyHttpError(status: number, providerId: string, body: string): InferenceError {
    if (status === 429) return new InferenceError("Rate limited", "rate_limit", providerId);
    return new InferenceError(`HTTP ${status}`, "provider_error", providerId);
  }

  return { InferenceError, classifyHttpError };
});

// ── Imports ──────────────────────────────────────────────────────────────────

import type { AdapterRequest } from "./adapter-types";
import type { RoutedExecutionPlan } from "./recipe-types";
import { embeddingAdapter } from "./embedding-adapter";
import { InferenceError } from "@/lib/ai-inference";

// ── Helpers ──────────────────────────────────────────────────────────────────

function makePlan(overrides: Partial<RoutedExecutionPlan> = {}): RoutedExecutionPlan {
  return {
    providerId: "openai",
    modelId: "text-embedding-3-small",
    recipeId: null,
    contractFamily: "sync.embedding",
    executionAdapter: "embedding",
    maxTokens: 0,
    providerSettings: {},
    toolPolicy: {},
    responsePolicy: {},
    ...overrides,
  };
}

function makeRequest(overrides: Partial<AdapterRequest> = {}): AdapterRequest {
  return {
    providerId: "openai",
    modelId: "text-embedding-3-small",
    plan: makePlan(),
    provider: {
      baseUrl: "https://api.openai.com/v1",
      headers: { Authorization: "Bearer sk-test" },
    },
    messages: [{ role: "user", content: "Hello world" }],
    systemPrompt: "",
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

// ── Tests ─────────────────────────────────────────────────────────────────────

describe("embeddingAdapter", () => {
  beforeEach(() => {
    mockFetch = vi.fn();
    vi.stubGlobal("fetch", mockFetch);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("has type 'embedding'", () => {
    expect(embeddingAdapter.type).toBe("embedding");
  });

  it("OpenAI: correct URL and body shape", async () => {
    stubFetchOk({
      data: [{ embedding: [0.1, 0.2, 0.3] }],
      usage: { prompt_tokens: 5, total_tokens: 5 },
    });

    await embeddingAdapter.execute(makeRequest());

    const [url, opts] = mockFetch.mock.calls[0];
    expect(url).toBe("https://api.openai.com/v1/embeddings");

    const body = JSON.parse(opts.body);
    expect(body.model).toBe("text-embedding-3-small");
    expect(body.input).toBe("Hello world");
    expect(body.encoding_format).toBe("float");
  });

  it("OpenAI: extracts embedding vector and token usage", async () => {
    const vector = [0.1, 0.2, 0.3, 0.4, 0.5];
    stubFetchOk({
      data: [{ embedding: vector }],
      usage: { prompt_tokens: 10, total_tokens: 10 },
    });

    const result = await embeddingAdapter.execute(makeRequest());

    expect(result.text).toBe(""); // no text for embeddings
    expect(result.toolCalls).toEqual([]);
    expect(result.usage.inputTokens).toBe(10);
    expect(result.usage.outputTokens).toBe(0);
    expect(result.raw?.embedding).toEqual(vector);
    expect(result.raw?.dimensions).toBe(5);
  });

  it("OpenAI: passes dimensions from providerSettings", async () => {
    stubFetchOk({
      data: [{ embedding: [0.1, 0.2] }],
      usage: { prompt_tokens: 5 },
    });

    const req = makeRequest({
      plan: makePlan({ providerSettings: { dimensions: 256 } }),
    });
    await embeddingAdapter.execute(req);

    const body = JSON.parse(mockFetch.mock.calls[0][1].body);
    expect(body.dimensions).toBe(256);
  });

  it("Gemini: correct URL and body shape", async () => {
    stubFetchOk({
      embedding: { values: [0.5, 0.6, 0.7] },
    });

    const req = makeRequest({
      providerId: "gemini",
      modelId: "text-embedding-004",
      plan: makePlan({ providerId: "gemini", modelId: "text-embedding-004" }),
      provider: {
        baseUrl: "https://generativelanguage.googleapis.com/v1beta",
        headers: { "Content-Type": "application/json" },
      },
    });

    const result = await embeddingAdapter.execute(req);

    const [url] = mockFetch.mock.calls[0];
    expect(url).toBe("https://generativelanguage.googleapis.com/v1beta/models/text-embedding-004:embedContent");

    const body = JSON.parse(mockFetch.mock.calls[0][1].body);
    expect(body.content).toEqual({ parts: [{ text: "Hello world" }] });

    expect(result.raw?.embedding).toEqual([0.5, 0.6, 0.7]);
    expect(result.raw?.dimensions).toBe(3);
  });

  it("extracts text from last user message", async () => {
    stubFetchOk({
      data: [{ embedding: [0.1] }],
      usage: { prompt_tokens: 3 },
    });

    const req = makeRequest({
      messages: [
        { role: "user", content: "first" },
        { role: "assistant", content: "ok" },
        { role: "user", content: "Embed this text" },
      ],
    });
    await embeddingAdapter.execute(req);

    const body = JSON.parse(mockFetch.mock.calls[0][1].body);
    expect(body.input).toBe("Embed this text");
  });

  it("network error throws InferenceError", async () => {
    mockFetch.mockRejectedValueOnce(new Error("ECONNREFUSED"));

    try {
      await embeddingAdapter.execute(makeRequest());
      expect.unreachable("Should have thrown");
    } catch (e) {
      expect(e).toBeInstanceOf(InferenceError);
      expect((e as InferenceError).code).toBe("network");
    }
  });
});
