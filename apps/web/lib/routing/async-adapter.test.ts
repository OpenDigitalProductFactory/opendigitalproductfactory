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
import { asyncAdapter } from "./async-adapter";
import { InferenceError } from "@/lib/ai-inference";

// ── Helpers ──────────────────────────────────────────────────────────────────

function makePlan(overrides: Partial<RoutedExecutionPlan> = {}): RoutedExecutionPlan {
  return {
    providerId: "gemini",
    modelId: "gemini-2.0-flash-thinking-exp",
    recipeId: null,
    contractFamily: "background.research",
    executionAdapter: "async",
    maxTokens: 0,
    providerSettings: {},
    toolPolicy: {},
    responsePolicy: {},
    ...overrides,
  };
}

function makeRequest(overrides: Partial<AdapterRequest> = {}): AdapterRequest {
  return {
    providerId: "gemini",
    modelId: "gemini-2.0-flash-thinking-exp",
    plan: makePlan(),
    provider: {
      baseUrl: "https://generativelanguage.googleapis.com/v1beta",
      headers: { "Content-Type": "application/json" },
    },
    messages: [{ role: "user", content: "Research the history of quantum computing" }],
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

function stubFetchError(status: number, body = "") {
  mockFetch.mockResolvedValueOnce({
    ok: false,
    status,
    text: async () => body,
    headers: new Headers(),
  });
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe("asyncAdapter", () => {
  beforeEach(() => {
    mockFetch = vi.fn();
    vi.stubGlobal("fetch", mockFetch);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("has type 'async'", () => {
    expect(asyncAdapter.type).toBe("async");
  });

  it("Gemini: calls startInteraction endpoint", async () => {
    stubFetchOk({
      name: "operations/abc123",
      done: false,
      metadata: {},
    });

    await asyncAdapter.execute(makeRequest());

    const [url] = mockFetch.mock.calls[0];
    expect(url).toBe(
      "https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash-thinking-exp:startInteraction",
    );
  });

  it("Gemini: extracts operation ID from response", async () => {
    stubFetchOk({
      name: "operations/deep-research-xyz",
      done: false,
    });

    const result = await asyncAdapter.execute(makeRequest());

    expect(result.text).toBe(""); // no result yet
    expect(result.toolCalls).toEqual([]);
    expect(result.raw?.operationId).toBe("operations/deep-research-xyz");
    expect(result.raw?.asyncStatus).toBe("accepted");
  });

  it("Gemini: sends user prompt in contents", async () => {
    stubFetchOk({ name: "operations/op1", done: false });

    await asyncAdapter.execute(makeRequest());

    const body = JSON.parse(mockFetch.mock.calls[0][1].body);
    expect(body.contents).toEqual([
      { role: "user", parts: [{ text: "Research the history of quantum computing" }] },
    ]);
  });

  it("throws when no operation ID in response", async () => {
    stubFetchOk({ done: false }); // no name field

    try {
      await asyncAdapter.execute(makeRequest());
      expect.unreachable("Should have thrown");
    } catch (e) {
      expect(e).toBeInstanceOf(InferenceError);
      expect((e as InferenceError).message).toContain("No operation ID");
    }
  });

  it("HTTP error throws InferenceError", async () => {
    stubFetchError(500, "Internal error");

    try {
      await asyncAdapter.execute(makeRequest());
      expect.unreachable("Should have thrown");
    } catch (e) {
      expect(e).toBeInstanceOf(InferenceError);
    }
  });

  it("network error throws InferenceError", async () => {
    mockFetch.mockRejectedValueOnce(new Error("ECONNREFUSED"));

    try {
      await asyncAdapter.execute(makeRequest());
      expect.unreachable("Should have thrown");
    } catch (e) {
      expect(e).toBeInstanceOf(InferenceError);
      expect((e as InferenceError).code).toBe("network");
    }
  });

  it("generic provider: uses chat/completions URL", async () => {
    stubFetchOk({ id: "op-generic-123" });

    const req = makeRequest({
      providerId: "openai",
      provider: {
        baseUrl: "https://api.openai.com/v1",
        headers: { Authorization: "Bearer sk-test" },
      },
    });
    const result = await asyncAdapter.execute(req);

    const [url] = mockFetch.mock.calls[0];
    expect(url).toBe("https://api.openai.com/v1/chat/completions");
    expect(result.raw?.operationId).toBe("op-generic-123");
  });

  it("extracts prompt from last user message", async () => {
    stubFetchOk({ name: "operations/op1", done: false });

    const req = makeRequest({
      messages: [
        { role: "user", content: "context" },
        { role: "assistant", content: "ok" },
        { role: "user", content: "Deep research on AI safety" },
      ],
    });
    await asyncAdapter.execute(req);

    const body = JSON.parse(mockFetch.mock.calls[0][1].body);
    expect(body.contents[0].parts[0].text).toBe("Deep research on AI safety");
  });

  it("returns timing info", async () => {
    stubFetchOk({ name: "operations/op1", done: false });

    const result = await asyncAdapter.execute(makeRequest());

    expect(result.inferenceMs).toBeGreaterThanOrEqual(0);
    expect(result.usage.inputTokens).toBe(0);
    expect(result.usage.outputTokens).toBe(0);
  });
});
