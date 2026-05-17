import { describe, expect, it, beforeEach, afterEach, vi } from "vitest";
import {
  registerExecutionAdapter,
  _resetAdaptersForTest,
} from "@/lib/routing/execution-adapter-registry";
import type { AdapterRequest, AdapterResult } from "@/lib/routing/adapter-types";

/**
 * Voice Input Slice 1 / Task 6 — transcribe() call-site tests.
 *
 * Asserts the call-site:
 *   - Resolves the endpoint via the routing-layer task-type selector for
 *     taskType="transcription" (not by hardcoding speaches).
 *   - Builds an AdapterRequest with the audio as a `type:"audio"` content
 *     part on the trailing user message.
 *   - Sets plan.executionAdapter="transcription" so callProvider dispatches
 *     to the registered transcription adapter (not the chat adapter).
 *   - Runs the bias-classification gate before placing the prompt in
 *     plan.providerSettings.prompt.
 *   - Projects AdapterResult → TranscribeResult with confidence normalized
 *     from raw.
 *
 * Reference signature read from apps/web/lib/inference/ai-inference.ts:335 :
 *
 *   export async function callProvider(
 *     providerId: string,
 *     modelId: string,
 *     messages: ChatMessage[],
 *     systemPrompt: string,
 *     tools?: Array<Record<string, unknown>>,
 *     plan?: RoutedExecutionPlan,
 *     previousResponseId?: string,
 *     mcpSession?: AdapterMcpSession,
 *     attribution?: { agentId?, threadId?, skillId? },
 *   ): Promise<InferenceResult>
 */

// Stub the prisma client at the lowest level — these tests do not touch the DB.
// The endpoint resolver inside transcribe() reads from EndpointTaskPerformance
// joined with ModelProfile; we mock the resolver instead of the DB so this is
// a unit test, not an integration test.
vi.mock("./endpoint-resolution", () => ({
  resolveTranscriptionEndpoint: vi.fn(async () => ({
    providerId: "speaches",
    modelId: "Systran/faster-distil-whisper-large-v3",
  })),
}));

// Mock callProvider so we can inspect the inputs without hitting a real
// provider or the registry execution. The registry composition is verified
// directly by the route's architecture test (Task 7).
vi.mock("@/lib/inference/ai-inference", async (importOriginal) => {
  const original = await importOriginal<typeof import("@/lib/inference/ai-inference")>();
  return {
    ...original,
    callProvider: vi.fn(async () => ({
      content: "Schedule the design review with Daisy for Friday.",
      inputTokens: 0,
      outputTokens: 0,
      inferenceMs: 3120,
      raw: {
        text: "Schedule the design review with Daisy for Friday.",
        language: "en",
        duration: 3.12,
        segments: [
          { avg_logprob: -0.142, no_speech_prob: 0.012 },
          { avg_logprob: -0.213, no_speech_prob: 0.018 },
        ],
      },
    })),
  };
});

import { transcribe } from "./transcribe";
import { callProvider } from "@/lib/inference/ai-inference";

describe("transcribe() call-site", () => {
  beforeEach(() => {
    _resetAdaptersForTest();
    // A no-op registered adapter so getExecutionAdapter("transcription") in
    // production code paths doesn't throw if any inner module touches it.
    registerExecutionAdapter({
      type: "transcription",
      async execute(_req: AdapterRequest): Promise<AdapterResult> {
        return {
          text: "(unused — callProvider is mocked)",
          toolCalls: [],
          usage: { inputTokens: 0, outputTokens: 0 },
          inferenceMs: 0,
          raw: {},
        };
      },
    });
    vi.mocked(callProvider).mockClear();
  });
  afterEach(() => _resetAdaptersForTest());

  it("calls callProvider with executionAdapter='transcription'", async () => {
    await transcribe({
      audioBase64: "AAAA",
      mimeType: "audio/webm",
      context: "coworker_panel",
    });
    expect(callProvider).toHaveBeenCalledTimes(1);
    const args = vi.mocked(callProvider).mock.calls[0];
    const plan = args[5]; // 6th positional arg is `plan`
    expect(plan).toBeDefined();
    expect(plan!.executionAdapter).toBe("transcription");
  });

  it("passes audio as a type:'audio' content part on the trailing user message", async () => {
    await transcribe({
      audioBase64: "BBBB",
      mimeType: "audio/mp4",
      context: "coworker_panel",
    });
    const messages = vi.mocked(callProvider).mock.calls[0][2];
    const lastMessage = messages[messages.length - 1];
    expect(lastMessage.role).toBe("user");
    expect(Array.isArray(lastMessage.content)).toBe(true);
    const audioPart = (lastMessage.content as unknown[]).find(
      (p) => p && typeof p === "object" && (p as Record<string, unknown>).type === "audio",
    ) as Record<string, unknown> | undefined;
    expect(audioPart).toBeDefined();
    expect(audioPart!.data).toBe("BBBB");
    expect(audioPart!.mimeType).toBe("audio/mp4");
  });

  it("dispatches to the resolved endpoint (speaches + distil-whisper) for taskType='transcription'", async () => {
    await transcribe({
      audioBase64: "CCCC",
      mimeType: "audio/webm",
      context: "coworker_panel",
    });
    const args = vi.mocked(callProvider).mock.calls[0];
    expect(args[0]).toBe("speaches");
    expect(args[1]).toBe("Systran/faster-distil-whisper-large-v3");
  });

  it("projects AdapterResult to TranscribeResult with normalized Whisper confidence", async () => {
    const result = await transcribe({
      audioBase64: "DDDD",
      mimeType: "audio/webm",
      context: "coworker_panel",
    });
    expect(result.text).toBe("Schedule the design review with Daisy for Friday.");
    expect(result.provider).toBe("speaches");
    expect(result.model).toBe("Systran/faster-distil-whisper-large-v3");
    expect(result.durationMs).toBe(3120);
    // exp(mean([-0.142, -0.213])) = exp(-0.1775) ≈ 0.837
    expect(result.confidence).not.toBeNull();
    expect(result.confidence!).toBeGreaterThan(0.8);
    expect(result.confidence!).toBeLessThan(0.9);
    expect(result.confidenceSource).toBe("normalized");
    expect(result.language).toBe("en");
  });

  it("reports biasUsed=false + biasRedacted=false when bias is empty (Slice 1 default)", async () => {
    const result = await transcribe({
      audioBase64: "EEEE",
      mimeType: "audio/webm",
      context: "coworker_panel",
    });
    expect(result.biasUsed).toBe(false);
    expect(result.biasRedacted).toBe(false);
  });

  it("places the bias prompt in plan.providerSettings.prompt when provided", async () => {
    await transcribe({
      audioBase64: "FFFF",
      mimeType: "audio/webm",
      context: "coworker_panel",
      biasPrompt: [
        { text: "Daisy", classification: "internal-low" },
        { text: "Kubernetes", classification: "public" },
      ],
    });
    const plan = vi.mocked(callProvider).mock.calls[0][5];
    expect(plan!.providerSettings.prompt).toBe("Daisy Kubernetes");
  });

  it("redacts confidential bias tokens when the resolved provider is off-org", async () => {
    // Override the resolver to return Groq (off-org).
    const { resolveTranscriptionEndpoint } = await import("./endpoint-resolution");
    vi.mocked(resolveTranscriptionEndpoint).mockResolvedValueOnce({
      providerId: "groq",
      modelId: "whisper-large-v3-turbo",
    });
    const result = await transcribe({
      audioBase64: "GGGG",
      mimeType: "audio/webm",
      context: "coworker_panel",
      biasPrompt: [
        { text: "Kubernetes", classification: "public" },
        { text: "API_SECRET", classification: "confidential" },
      ],
    });
    const plan = vi.mocked(callProvider).mock.calls[0][5];
    expect(plan!.providerSettings.prompt).toBe("Kubernetes");
    expect(result.biasUsed).toBe(true);
    expect(result.biasRedacted).toBe(true);
  });

  it("forwards the language hint when provided", async () => {
    await transcribe({
      audioBase64: "HHHH",
      mimeType: "audio/webm",
      context: "coworker_panel",
      language: "fr",
    });
    const plan = vi.mocked(callProvider).mock.calls[0][5];
    expect(plan!.providerSettings.language).toBe("fr");
  });
});
