import { describe, expect, it, beforeEach, vi } from "vitest";

/**
 * Voice Input Slice 1 / Task 7 — POST /api/transcribe functional tests.
 *
 * Covers validation + projection + error mapping per spec §6.5 + §7.2.
 * The composition-through-registry invariant is asserted by
 * route.architecture.test.ts; this file uses higher-level mocks so each
 * test can target one behaviour cleanly.
 */

const { mockTranscribe } = vi.hoisted(() => ({
  mockTranscribe: vi.fn(),
}));

vi.mock("@/lib/voice/transcribe", () => ({
  transcribe: mockTranscribe,
}));

import { POST } from "./route";
import { InferenceError } from "@/lib/ai-inference";
import { NoTranscriptionEndpointError } from "@/lib/voice/endpoint-resolution";

function makeFormRequest(fields: Record<string, string | Blob>): Request {
  const form = new FormData();
  for (const [key, value] of Object.entries(fields)) {
    form.append(key, value);
  }
  return new Request("http://test/api/transcribe", { method: "POST", body: form });
}

function audioBlob(mime: string, bytes = 8): Blob {
  return new Blob([new Uint8Array(bytes)], { type: mime });
}

describe("POST /api/transcribe — validation", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("400 when audio field is missing", async () => {
    const res = await POST(makeFormRequest({ context: "test_harness" }) as never);
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error.class).toBe("tool-denied");
    expect(body.error.message).toMatch(/audio/i);
  });

  it("400 when context field is missing", async () => {
    const res = await POST(
      makeFormRequest({ audio: audioBlob("audio/webm") }) as never,
    );
    expect(res.status).toBe(400);
    expect((await res.json()).error.message).toMatch(/context/i);
  });

  it("400 when context is invalid", async () => {
    const res = await POST(
      makeFormRequest({
        audio: audioBlob("audio/webm"),
        context: "not_a_real_context",
      }) as never,
    );
    expect(res.status).toBe(400);
  });

  it("415 when MIME is not audio/*", async () => {
    const res = await POST(
      makeFormRequest({
        audio: new Blob([new Uint8Array(8)], { type: "image/png" }),
        context: "test_harness",
      }) as never,
    );
    expect(res.status).toBe(415);
    expect((await res.json()).error.class).toBe("tool-denied");
  });

  it("413 when audio exceeds the 25 MB limit", async () => {
    // Build a blob just over the limit. ArrayBuffer is cheap as a Uint8Array.
    const over = new Uint8Array(25 * 1024 * 1024 + 1);
    const res = await POST(
      makeFormRequest({
        audio: new Blob([over], { type: "audio/webm" }),
        context: "test_harness",
      }) as never,
    );
    expect(res.status).toBe(413);
  });
});

describe("POST /api/transcribe — success projection", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockTranscribe.mockResolvedValue({
      text: "Hello, world.",
      rawText: "hello world",
      confidence: 0.94,
      confidenceSource: "normalized",
      language: "en",
      durationMs: 1234,
      provider: "speaches",
      model: "base",
      biasUsed: false,
      biasRedacted: false,
    });
  });

  it("200 + spec §6.5 response shape on valid input", async () => {
    const res = await POST(
      makeFormRequest({
        audio: audioBlob("audio/webm"),
        context: "coworker_panel",
        threadId: "thread-123",
      }) as never,
    );
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toMatchObject({
      text: "Hello, world.",
      rawText: "hello world",
      confidence: 0.94,
      confidenceSource: "normalized",
      language: "en",
      durationMs: 1234,
      provider: "speaches",
      model: "base",
      biasUsed: false,
      biasRedacted: false,
    });
  });

  it("forwards threadId, language, tierHint to transcribe()", async () => {
    await POST(
      makeFormRequest({
        audio: audioBlob("audio/webm"),
        context: "coworker_panel",
        threadId: "thread-abc",
        language: "fr",
        tierHint: "small",
      }) as never,
    );
    expect(mockTranscribe).toHaveBeenCalledTimes(1);
    const input = mockTranscribe.mock.calls[0][0];
    expect(input.threadId).toBe("thread-abc");
    expect(input.language).toBe("fr");
    expect(input.tierHint).toBe("small");
    expect(input.context).toBe("coworker_panel");
  });

  it("accepts Safari audio/mp4 MIME and forwards it to transcribe()", async () => {
    await POST(
      makeFormRequest({
        audio: audioBlob("audio/mp4"),
        context: "coworker_panel",
      }) as never,
    );
    const input = mockTranscribe.mock.calls[0][0];
    expect(input.mimeType).toBe("audio/mp4");
  });

  it("parses biasPrompt JSON when provided and forwards it", async () => {
    await POST(
      makeFormRequest({
        audio: audioBlob("audio/webm"),
        context: "coworker_panel",
        biasPrompt: JSON.stringify([
          { text: "Kubernetes", classification: "public" },
        ]),
      }) as never,
    );
    const input = mockTranscribe.mock.calls[0][0];
    expect(input.biasPrompt).toEqual([
      { text: "Kubernetes", classification: "public" },
    ]);
  });

  it("silently ignores malformed biasPrompt JSON (bias is advisory)", async () => {
    await POST(
      makeFormRequest({
        audio: audioBlob("audio/webm"),
        context: "coworker_panel",
        biasPrompt: "{not json",
      }) as never,
    );
    const input = mockTranscribe.mock.calls[0][0];
    expect(input.biasPrompt).toBeUndefined();
  });
});

describe("POST /api/transcribe — error mapping (spec §7.2)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("503 when no transcription endpoint is configured", async () => {
    mockTranscribe.mockRejectedValueOnce(new NoTranscriptionEndpointError());
    const res = await POST(
      makeFormRequest({
        audio: audioBlob("audio/webm"),
        context: "test_harness",
      }) as never,
    );
    expect(res.status).toBe(503);
    expect((await res.json()).error.class).toBe("tool-error");
  });

  it("503 when provider is unreachable (InferenceError code=network)", async () => {
    mockTranscribe.mockRejectedValueOnce(
      new InferenceError("Connection refused", "network", "speaches"),
    );
    const res = await POST(
      makeFormRequest({
        audio: audioBlob("audio/webm"),
        context: "test_harness",
      }) as never,
    );
    expect(res.status).toBe(503);
  });

  it("502 when provider returns an error (InferenceError code=provider_error)", async () => {
    mockTranscribe.mockRejectedValueOnce(
      new InferenceError("500 Internal", "provider_error", "speaches", 500),
    );
    const res = await POST(
      makeFormRequest({
        audio: audioBlob("audio/webm"),
        context: "test_harness",
      }) as never,
    );
    expect(res.status).toBe(502);
  });

  it("503 when provider is rate-limited", async () => {
    mockTranscribe.mockRejectedValueOnce(
      new InferenceError("Rate limit", "rate_limit", "groq", 429),
    );
    const res = await POST(
      makeFormRequest({
        audio: audioBlob("audio/webm"),
        context: "test_harness",
      }) as never,
    );
    expect(res.status).toBe(503);
  });

  it("500 on unknown errors with the error message preserved", async () => {
    mockTranscribe.mockRejectedValueOnce(new Error("unexpected"));
    const res = await POST(
      makeFormRequest({
        audio: audioBlob("audio/webm"),
        context: "test_harness",
      }) as never,
    );
    expect(res.status).toBe(500);
    expect((await res.json()).error.message).toMatch(/unexpected/);
  });
});
