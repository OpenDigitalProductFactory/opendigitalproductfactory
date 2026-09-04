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

  it("Gemini: starts a background interaction through the current Interactions API", async () => {
    stubFetchOk({
      id: "interaction-abc123",
      object: "interaction",
      status: "in_progress",
    });

    await asyncAdapter.execute(makeRequest());

    const [url, init] = mockFetch.mock.calls[0];
    expect(url).toBe("https://generativelanguage.googleapis.com/v1beta/interactions");
    expect(JSON.parse(init.body)).toEqual({
      model: "gemini-2.0-flash-thinking-exp",
      input: "Research the history of quantum computing",
      background: true,
    });
  });

  it("Gemini: returns a typed async-operation start result", async () => {
    stubFetchOk({
      id: "interaction-deep-research-xyz",
      object: "interaction",
      status: "in_progress",
    });

    const result = await asyncAdapter.execute(makeRequest());

    expect(result.text).toBe(""); // no result yet
    expect(result.toolCalls).toEqual([]);
    expect(result.asyncOperation).toEqual({
      status: "accepted",
      providerOperationId: "interaction-deep-research-xyz",
    });
  });

  it("Gemini: accepts a queued interaction as a nonterminal async start", async () => {
    stubFetchOk({
      id: "interaction-queued-xyz",
      object: "interaction",
      status: "queued",
    });

    await expect(asyncAdapter.execute(makeRequest())).resolves.toMatchObject({
      asyncOperation: {
        status: "accepted",
        providerOperationId: "interaction-queued-xyz",
      },
    });
  });

  it("Gemini: refuses requires_action because this adapter has no continuation path", async () => {
    stubFetchOk({
      id: "interaction-action-required",
      object: "interaction",
      status: "requires_action",
    });

    await expect(asyncAdapter.execute(makeRequest())).rejects.toMatchObject({
      code: "provider_error",
      message: expect.stringMatching(/requires_action.*continuation/i),
    });
  });

  it.each([
    "completed",
    "incomplete",
    "failed",
    "cancelled",
    "budget_exceeded",
  ])("Gemini: refuses terminal create status %s", async (status) => {
    stubFetchOk({
      id: `interaction-${status}`,
      object: "interaction",
      status,
    });

    await expect(asyncAdapter.execute(makeRequest())).rejects.toMatchObject({
      code: "provider_error",
      message: expect.stringContaining(`terminal interaction status ${status}`),
    });
  });

  it("Gemini: uses the agent field for a managed Deep Research agent", async () => {
    // The provider schema permits omission of the optional object discriminator.
    stubFetchOk({ id: "interaction-op1", status: "in_progress" });

    await asyncAdapter.execute(makeRequest({
      modelId: "deep-research-pro-preview-12-2025",
      plan: makePlan({ modelId: "deep-research-pro-preview-12-2025" }),
      systemPrompt: "Return cited primary sources.",
    }));

    const body = JSON.parse(mockFetch.mock.calls[0][1].body);
    expect(body).toEqual({
      agent: "deep-research-pro-preview-12-2025",
      input: "Research the history of quantum computing",
      system_instruction: "Return cited primary sources.",
      background: true,
    });
  });

  it("throws when no operation ID in response", async () => {
    stubFetchOk({ object: "interaction", status: "in_progress" }); // no id field

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

  it("rejects a provider without an explicit long-running-operation protocol", async () => {
    const req = makeRequest({
      providerId: "openai",
      provider: {
        baseUrl: "https://api.openai.com/v1",
        headers: { Authorization: "Bearer sk-test" },
      },
    });

    await expect(asyncAdapter.execute(req)).rejects.toMatchObject({
      code: "provider_error",
      message: expect.stringContaining("does not support"),
    });
    expect(mockFetch).not.toHaveBeenCalled();
  });

  it("rejects a non-string Gemini operation ID", async () => {
    stubFetchOk({ id: 42, object: "interaction", status: "in_progress" });

    await expect(asyncAdapter.execute(makeRequest())).rejects.toMatchObject({
      code: "provider_error",
      message: expect.stringContaining("No operation ID"),
    });
  });

  it("rejects a response with a conflicting object discriminator", async () => {
    stubFetchOk({
      id: "interaction-op1",
      object: "chat.completion",
      status: "in_progress",
    });

    await expect(asyncAdapter.execute(makeRequest())).rejects.toMatchObject({
      code: "provider_error",
      message: expect.stringContaining("invalid interaction response"),
    });
  });

  it("extracts prompt from last user message", async () => {
    stubFetchOk({ id: "interaction-op1", object: "interaction", status: "in_progress" });

    const req = makeRequest({
      messages: [
        { role: "user", content: "context" },
        { role: "assistant", content: "ok" },
        { role: "user", content: "Deep research on AI safety" },
      ],
    });
    await asyncAdapter.execute(req);

    const body = JSON.parse(mockFetch.mock.calls[0][1].body);
    expect(body.input).toBe("Deep research on AI safety");
  });

  it("returns timing info", async () => {
    stubFetchOk({ id: "interaction-op1", object: "interaction", status: "in_progress" });

    const result = await asyncAdapter.execute(makeRequest());

    expect(result.inferenceMs).toBeGreaterThanOrEqual(0);
    expect(result.usage.inputTokens).toBe(0);
    expect(result.usage.outputTokens).toBe(0);
  });
});
