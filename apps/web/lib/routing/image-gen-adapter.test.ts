import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";

// ── Mocks ────────────────────────────────────────────────────────────────────

vi.mock("@/lib/ai-inference", () => {
  class InferenceError extends Error {
    name = "InferenceError";
    constructor(
      message: string,
      public readonly code: string,
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
    if (status === 429) return new InferenceError("Rate limited", "rate_limit", providerId, status);
    if (status === 401 || status === 403) return new InferenceError("Auth failed", "auth", providerId, status);
    return new InferenceError(`HTTP ${status}`, "provider_error", providerId, status);
  }

  return { InferenceError, classifyHttpError };
});

// ── Imports ──────────────────────────────────────────────────────────────────

import type { AdapterRequest } from "./adapter-types";
import type { RoutedExecutionPlan } from "./recipe-types";
import { imageGenAdapter } from "./image-gen-adapter";
import { InferenceError } from "@/lib/ai-inference";

// ── Helpers ──────────────────────────────────────────────────────────────────

function makePlan(overrides: Partial<RoutedExecutionPlan> = {}): RoutedExecutionPlan {
  return {
    providerId: "openai",
    modelId: "dall-e-3",
    recipeId: null,
    contractFamily: "sync.image-gen",
    executionAdapter: "image_gen",
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
    modelId: "dall-e-3",
    plan: makePlan(),
    provider: {
      baseUrl: "https://api.openai.com/v1",
      headers: { Authorization: "Bearer sk-test" },
    },
    messages: [{ role: "user", content: "A cat wearing a top hat" }],
    systemPrompt: "",
    ...overrides,
  };
}

// ── Mock fetch ────────────────────────────────────────────────────────────────

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

// ── Tests ─────────────────────────────────────────────────────────────────────

describe("imageGenAdapter", () => {
  beforeEach(() => {
    mockFetch = vi.fn();
    vi.stubGlobal("fetch", mockFetch);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("has type 'image_gen'", () => {
    expect(imageGenAdapter.type).toBe("image_gen");
  });

  it("OpenAI: correct URL and body shape", async () => {
    stubFetchOk({
      data: [{ url: "https://example.com/cat.png", revised_prompt: "A cute cat with a top hat" }],
    });

    const req = makeRequest();
    await imageGenAdapter.execute(req);

    const [url, opts] = mockFetch.mock.calls[0];
    expect(url).toBe("https://api.openai.com/v1/images/generations");

    const body = JSON.parse(opts.body);
    expect(body.model).toBe("dall-e-3");
    expect(body.prompt).toBe("A cat wearing a top hat");
    expect(body.n).toBe(1);
    expect(body.size).toBe("1024x1024");
    expect(body.response_format).toBe("url");
  });

  it("OpenAI: extracts image URL from response", async () => {
    stubFetchOk({
      data: [{ url: "https://example.com/cat.png", revised_prompt: "A cute cat with a top hat" }],
    });

    const result = await imageGenAdapter.execute(makeRequest());

    expect(result.text).toBe("https://example.com/cat.png");
    expect(result.toolCalls).toEqual([]);
    expect(result.usage.inputTokens).toBe(0);
    expect(result.usage.outputTokens).toBe(0);
    expect(result.raw?.imageUrl).toBe("https://example.com/cat.png");
    expect(result.raw?.revisedPrompt).toBe("A cute cat with a top hat");
  });

  it("OpenAI: extracts b64_json as data URI", async () => {
    stubFetchOk({
      data: [{ b64_json: "iVBORw0KGgo=" }],
    });

    const req = makeRequest({
      plan: makePlan({ providerSettings: { response_format: "b64_json" } }),
    });
    const result = await imageGenAdapter.execute(req);

    expect(result.text).toContain("data:image/png;base64,iVBORw0KGgo=");
  });

  it("OpenAI: passes size and quality from providerSettings", async () => {
    stubFetchOk({ data: [{ url: "https://example.com/img.png" }] });

    const req = makeRequest({
      plan: makePlan({ providerSettings: { size: "512x512", quality: "hd" } }),
    });
    await imageGenAdapter.execute(req);

    const body = JSON.parse(mockFetch.mock.calls[0][1].body);
    expect(body.size).toBe("512x512");
    expect(body.quality).toBe("hd");
  });

  it("Gemini: correct URL and body shape", async () => {
    stubFetchOk({
      candidates: [{
        content: {
          parts: [
            { inlineData: { mimeType: "image/png", data: "base64data" } },
            { text: "Here's your image" },
          ],
        },
      }],
    });

    const req = makeRequest({
      providerId: "gemini",
      modelId: "imagen-3.0-generate-002",
      plan: makePlan({ providerId: "gemini", modelId: "imagen-3.0-generate-002" }),
      provider: {
        baseUrl: "https://generativelanguage.googleapis.com/v1beta",
        headers: { "Content-Type": "application/json" },
      },
    });

    const result = await imageGenAdapter.execute(req);

    const [url] = mockFetch.mock.calls[0];
    expect(url).toBe("https://generativelanguage.googleapis.com/v1beta/models/imagen-3.0-generate-002:generateContent");

    expect(result.text).toContain("data:image/png;base64,base64data");
    expect(result.raw?.revisedPrompt).toBe("Here's your image");
  });

  it("extracts prompt from last user message", async () => {
    stubFetchOk({ data: [{ url: "https://example.com/img.png" }] });

    const req = makeRequest({
      messages: [
        { role: "user", content: "first message" },
        { role: "assistant", content: "ok" },
        { role: "user", content: "Draw a dog" },
      ],
    });
    await imageGenAdapter.execute(req);

    const body = JSON.parse(mockFetch.mock.calls[0][1].body);
    expect(body.prompt).toBe("Draw a dog");
  });

  it("HTTP error throws InferenceError", async () => {
    stubFetchError(429, "Rate limited");

    try {
      await imageGenAdapter.execute(makeRequest());
      expect.unreachable("Should have thrown");
    } catch (e) {
      expect(e).toBeInstanceOf(InferenceError);
    }
  });

  it("network error throws InferenceError", async () => {
    mockFetch.mockRejectedValueOnce(new Error("ECONNREFUSED"));

    try {
      await imageGenAdapter.execute(makeRequest());
      expect.unreachable("Should have thrown");
    } catch (e) {
      expect(e).toBeInstanceOf(InferenceError);
      expect((e as InferenceError).code).toBe("network");
    }
  });
});
