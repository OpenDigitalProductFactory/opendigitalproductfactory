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
import { transcriptionAdapter } from "./transcription-adapter";
import { InferenceError } from "@/lib/ai-inference";

// ── Helpers ──────────────────────────────────────────────────────────────────

function makePlan(overrides: Partial<RoutedExecutionPlan> = {}): RoutedExecutionPlan {
  return {
    providerId: "openai",
    modelId: "whisper-1",
    recipeId: null,
    contractFamily: "sync.transcription",
    executionAdapter: "transcription",
    maxTokens: 0,
    providerSettings: {},
    toolPolicy: {},
    responsePolicy: {},
    ...overrides,
  };
}

// Simple base64 for "hello" in binary
const SAMPLE_AUDIO_BASE64 = btoa("fake-audio-data");

function makeRequest(overrides: Partial<AdapterRequest> = {}): AdapterRequest {
  return {
    providerId: "openai",
    modelId: "whisper-1",
    plan: makePlan(),
    provider: {
      baseUrl: "https://api.openai.com/v1",
      headers: { Authorization: "Bearer sk-test", "Content-Type": "application/json" },
    },
    messages: [{
      role: "user",
      content: [
        { type: "audio", data: SAMPLE_AUDIO_BASE64, mimeType: "audio/mp3" },
      ] as any,
    }],
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

describe("transcriptionAdapter", () => {
  beforeEach(() => {
    mockFetch = vi.fn();
    vi.stubGlobal("fetch", mockFetch);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("has type 'transcription'", () => {
    expect(transcriptionAdapter.type).toBe("transcription");
  });

  it("sends multipart/form-data to correct URL", async () => {
    stubFetchOk({ text: "Hello, this is the transcription." });

    await transcriptionAdapter.execute(makeRequest());

    const [url, opts] = mockFetch.mock.calls[0];
    expect(url).toBe("https://api.openai.com/v1/audio/transcriptions");
    // Should be FormData, not JSON
    expect(opts.body).toBeInstanceOf(FormData);
  });

  it("removes Content-Type header for FormData", async () => {
    stubFetchOk({ text: "transcription" });

    await transcriptionAdapter.execute(makeRequest());

    const opts = mockFetch.mock.calls[0][1];
    // Content-Type should NOT be set (fetch auto-sets boundary for FormData)
    expect(opts.headers["Content-Type"]).toBeUndefined();
    expect(opts.headers["content-type"]).toBeUndefined();
    // Auth header should still be present
    expect(opts.headers["Authorization"]).toBe("Bearer sk-test");
  });

  it("extracts transcription text from response", async () => {
    stubFetchOk({ text: "The quick brown fox jumps over the lazy dog." });

    const result = await transcriptionAdapter.execute(makeRequest());

    expect(result.text).toBe("The quick brown fox jumps over the lazy dog.");
    expect(result.toolCalls).toEqual([]);
    expect(result.usage.inputTokens).toBe(0);
    expect(result.usage.outputTokens).toBe(0);
  });

  it("includes model in form data", async () => {
    stubFetchOk({ text: "transcription" });

    await transcriptionAdapter.execute(makeRequest());

    const form = mockFetch.mock.calls[0][1].body as FormData;
    expect(form.get("model")).toBe("whisper-1");
    expect(form.get("response_format")).toBe("json");
  });

  it("passes language from providerSettings", async () => {
    stubFetchOk({ text: "transcription" });

    const req = makeRequest({
      plan: makePlan({ providerSettings: { language: "en" } }),
    });
    await transcriptionAdapter.execute(req);

    const form = mockFetch.mock.calls[0][1].body as FormData;
    expect(form.get("language")).toBe("en");
  });

  it("throws when no audio data in messages", async () => {
    const req = makeRequest({
      messages: [{ role: "user", content: "No audio here" }],
    });

    try {
      await transcriptionAdapter.execute(req);
      expect.unreachable("Should have thrown");
    } catch (e) {
      expect(e).toBeInstanceOf(InferenceError);
      expect((e as InferenceError).message).toContain("No audio data");
    }
  });

  it("network error throws InferenceError", async () => {
    mockFetch.mockRejectedValueOnce(new Error("ECONNREFUSED"));

    try {
      await transcriptionAdapter.execute(makeRequest());
      expect.unreachable("Should have thrown");
    } catch (e) {
      expect(e).toBeInstanceOf(InferenceError);
      expect((e as InferenceError).code).toBe("network");
    }
  });

  it("preserves raw response data", async () => {
    const response = {
      text: "transcription text",
      segments: [{ start: 0, end: 5.2, text: "transcription text" }],
    };
    stubFetchOk(response);

    const result = await transcriptionAdapter.execute(makeRequest());

    expect(result.raw).toBeDefined();
    expect((result.raw as any).segments).toBeDefined();
  });
});
