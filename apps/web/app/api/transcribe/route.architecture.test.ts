import { describe, expect, it, beforeEach, afterEach, vi } from "vitest";

/**
 * Voice Input Slice 1 / Task 7 — THE ARCHITECTURE TEST.
 *
 * Owning plan: docs/superpowers/plans/2026-05-16-voice-input-slice-1-portal-mic.md
 * Owning spec: docs/superpowers/specs/2026-05-16-voice-input-and-transcription-design.md §8 Slice 1 DoD
 *
 * The plan's gating invariant for Slice 1:
 *
 *   POST /api/transcribe MUST compose the existing `transcription` execution
 *   adapter via the routing-layer registry. It MUST NOT construct multipart
 *   bodies directly. It MUST NOT call the speaches sidecar directly. It MUST
 *   NOT import transcription-adapter.ts internals.
 *
 * This test substitutes a FAKE adapter at the registry level and verifies the
 * route's response shape derives from the fake adapter's AdapterResult. If
 * future refactors regress to a parallel HTTP client (bypassing the registry),
 * this test will continue to pass with the fake adapter not being called —
 * so we ALSO assert the fake's `execute` was invoked exactly once.
 *
 * Without this test, future refactors will silently regress.
 */

const {
  mockResolveTranscriptionEndpoint,
  mockPrismaModelProviderFindUnique,
  mockResolveExecutionBaseUrl,
  mockBuildAuthHeaders,
} = vi.hoisted(() => ({
  mockResolveTranscriptionEndpoint: vi.fn(async () => ({
    providerId: "speaches",
    modelId: "Systran/faster-distil-whisper-large-v3",
  })),
  mockPrismaModelProviderFindUnique: vi.fn(async () => ({
    providerId: "speaches",
    name: "Speaches",
    endpointType: "transcription",
    baseUrl: "http://dpf-stt:8000",
    authMethod: "none",
    authHeader: null,
    status: "active",
  })),
  mockResolveExecutionBaseUrl: vi.fn(async () => "http://dpf-stt:8000"),
  mockBuildAuthHeaders: vi.fn(async () => ({})),
}));

vi.mock("@/lib/voice/endpoint-resolution", () => ({
  resolveTranscriptionEndpoint: mockResolveTranscriptionEndpoint,
  NoTranscriptionEndpointError: class NoTranscriptionEndpointError extends Error {
    name = "NoTranscriptionEndpointError";
  },
}));

vi.mock("@dpf/db", () => ({
  prisma: {
    modelProvider: { findUnique: mockPrismaModelProviderFindUnique },
    adapterRunTelemetry: { create: vi.fn() },
  },
}));

import {
  registerExecutionAdapter,
  _resetAdaptersForTest,
} from "@/lib/routing/execution-adapter-registry";
import type { AdapterRequest, AdapterResult, ExecutionAdapterHandler } from "@/lib/routing/adapter-types";

// Eagerly import the route at module top so the transitive
// `import "../routing/transcription-adapter"` side-effect runs ONCE here.
// Without this, lazy `await import("./route")` inside a test would re-register
// the real transcription adapter and overwrite our fake on the first test run.
import { POST } from "./route";

describe("ARCHITECTURE: /api/transcribe composes the transcription registry adapter", () => {
  let fakeExecuteCalls: AdapterRequest[];
  let fakeAdapter: ExecutionAdapterHandler;

  beforeEach(() => {
    vi.clearAllMocks();
    // Now-safe to reset: the side-effect imports have already registered all
    // real adapters at top-of-file. We swap "transcription" for the fake.
    _resetAdaptersForTest();

    fakeExecuteCalls = [];
    fakeAdapter = {
      type: "transcription",
      async execute(req: AdapterRequest): Promise<AdapterResult> {
        fakeExecuteCalls.push(req);
        return {
          text: "FAKE_ADAPTER_OUTPUT",
          toolCalls: [],
          usage: { inputTokens: 0, outputTokens: 0 },
          inferenceMs: 42,
          raw: {
            text: "FAKE_ADAPTER_OUTPUT",
            language: "en",
            segments: [
              { avg_logprob: -0.2, no_speech_prob: 0.01 },
            ],
          },
        };
      },
    };
    registerExecutionAdapter(fakeAdapter);
  });

  afterEach(() => {
    _resetAdaptersForTest();
  });

  it("dispatches through the registry-registered transcription adapter (NOT a parallel HTTP client)", async () => {
    const form = new FormData();
    const audio = new Blob([new Uint8Array([0x4f, 0x67, 0x67, 0x53])], { type: "audio/ogg" });
    form.append("audio", audio, "test.ogg");
    form.append("context", "test_harness");

    const req = new Request("http://test/api/transcribe", {
      method: "POST",
      body: form,
    });
    const res = await POST(req as never);
    const body = await res.json();

    // The fake adapter was invoked through the registry — composition is proven.
    expect(fakeExecuteCalls.length).toBe(1);
    // The route's response text is derived from the fake adapter's AdapterResult.text.
    expect(body.text).toBe("FAKE_ADAPTER_OUTPUT");
    // The route's durationMs is derived from the fake adapter's inferenceMs.
    expect(body.durationMs).toBe(42);
    // The route projects provider/model from the resolved endpoint (not from
    // a hardcoded value or a direct sidecar lookup).
    expect(body.provider).toBe("speaches");
    expect(body.model).toBe("Systran/faster-distil-whisper-large-v3");
    // Confidence is normalized from the fake adapter's raw.segments — proves
    // the InferenceResult.raw passthrough works end-to-end (not just in
    // transcribe.test.ts which mocks callProvider).
    // exp(-0.2) ≈ 0.819
    expect(body.confidenceSource).toBe("normalized");
    expect(body.confidence).not.toBeNull();
    expect(body.confidence).toBeGreaterThan(0.8);
    expect(body.confidence).toBeLessThan(0.85);
  });

  it("the dispatched AdapterRequest contains executionAdapter='transcription'", async () => {
    const form = new FormData();
    form.append("audio", new Blob([new Uint8Array(8)], { type: "audio/webm" }), "test.webm");
    form.append("context", "test_harness");

    const req = new Request("http://test/api/transcribe", { method: "POST", body: form });
    await POST(req as never);

    expect(fakeExecuteCalls.length).toBe(1);
    const dispatched = fakeExecuteCalls[0];
    expect(dispatched.plan.executionAdapter).toBe("transcription");
  });

  it("the dispatched AdapterRequest carries audio as a base64 content part", async () => {
    const form = new FormData();
    const bytes = new Uint8Array([0x52, 0x49, 0x46, 0x46]); // "RIFF" magic
    form.append("audio", new Blob([bytes], { type: "audio/wav" }), "test.wav");
    form.append("context", "test_harness");

    const req = new Request("http://test/api/transcribe", { method: "POST", body: form });
    await POST(req as never);

    expect(fakeExecuteCalls.length).toBe(1);
    const dispatched = fakeExecuteCalls[0];
    const lastMessage = dispatched.messages[dispatched.messages.length - 1];
    expect(lastMessage.role).toBe("user");
    expect(Array.isArray(lastMessage.content)).toBe(true);
    const audioPart = (lastMessage.content as unknown[]).find(
      (p) => p && typeof p === "object" && (p as Record<string, unknown>).type === "audio",
    ) as Record<string, unknown> | undefined;
    expect(audioPart).toBeDefined();
    // RIFF in base64 is "UklGRg=="
    expect(audioPart!.data).toBe("UklGRg==");
    expect(audioPart!.mimeType).toBe("audio/wav");
  });

  it("Safari-shape mp4/AAC audio round-trips through the registry", async () => {
    // Per spec §7.3: Safari emits audio/mp4. The architecture test must prove
    // the route doesn't reject Safari uploads and that the adapter sees them.
    const form = new FormData();
    const bytes = new Uint8Array([0x00, 0x00, 0x00, 0x18]); // mp4 ftyp box header start
    form.append("audio", new Blob([bytes], { type: "audio/mp4" }), "safari.mp4");
    form.append("context", "test_harness");

    const req = new Request("http://test/api/transcribe", { method: "POST", body: form });
    const res = await POST(req as never);

    expect(res.status).toBe(200);
    expect(fakeExecuteCalls.length).toBe(1);
    const lastMessage = fakeExecuteCalls[0].messages[fakeExecuteCalls[0].messages.length - 1];
    const audioPart = (lastMessage.content as unknown[]).find(
      (p) => p && typeof p === "object" && (p as Record<string, unknown>).type === "audio",
    ) as Record<string, unknown> | undefined;
    expect(audioPart!.mimeType).toBe("audio/mp4");
  });
});
