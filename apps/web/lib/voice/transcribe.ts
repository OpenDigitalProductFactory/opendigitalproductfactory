/**
 * Voice Input Slice 1 / Task 6 — transcribe() call-site.
 *
 * Owning plan: docs/superpowers/plans/2026-05-16-voice-input-slice-1-portal-mic.md
 * Owning spec: docs/superpowers/specs/2026-05-16-voice-input-and-transcription-design.md §6.5
 *
 * Thin wrapper around the routing layer's callProvider. Builds an
 * AdapterRequest with the audio as a `type:"audio"` content part on the
 * trailing user message, sets executionAdapter="transcription" so callProvider
 * dispatches to the registered transcription adapter (apps/web/lib/routing/
 * transcription-adapter.ts), applies the bias-classification gate before any
 * off-org send, and projects the result.
 *
 * The architecture test for Task 7 asserts /api/transcribe routes through the
 * registry adapter (substitutes a fake adapter at registry level and verifies
 * the route's response shape matches). This file does NOT construct multipart
 * bodies, does NOT call the speaches sidecar directly, and does NOT import
 * transcription-adapter internals — composition via callProvider only.
 *
 * No LLM dependency in Slice 1 (spec §6.0). Audio → text via Whisper sidecar.
 */

import { callProvider, type InferenceResult, type ChatMessage } from "@/lib/inference/ai-inference";
import type { RoutedExecutionPlan } from "@/lib/routing/recipe-types";
import { classifyBiasPrompt } from "./bias-classification-gate";
import { normalizeConfidence } from "./confidence-normalize";
import { resolveTranscriptionEndpoint } from "./endpoint-resolution";
import type { TranscribeInput, TranscribeResult } from "./types";

/**
 * Build the chat-message envelope with the audio as a base64 content part.
 * The transcription adapter (apps/web/lib/routing/transcription-adapter.ts)
 * extracts the audio via extractAudioData() looking for type:"audio" parts.
 */
function buildAudioMessages(audioBase64: string, mimeType: string): ChatMessage[] {
  return [
    {
      role: "user",
      content: [
        {
          type: "audio",
          data: audioBase64,
          mimeType,
        } as unknown as Record<string, unknown>,
      ] as unknown as string,
      // Note: ChatMessage.content is typed as string in the canonical inference
      // layer; the transcription adapter accepts a structured array via the
      // same field. The double cast is intentional and bounded to this single
      // call-site — see adapter-types.ts AudioContentPart for the contract.
    },
  ];
}

/**
 * Build the RoutedExecutionPlan for transcription. The executionAdapter
 * field is the key — it dispatches to the registered transcription adapter.
 */
function buildTranscriptionPlan(args: {
  providerId: string;
  modelId: string;
  biasPrompt: string;
  language?: string;
}): RoutedExecutionPlan {
  const providerSettings: Record<string, unknown> = {
    response_format: "verbose_json",
  };
  if (args.biasPrompt.length > 0) providerSettings.prompt = args.biasPrompt;
  if (args.language) providerSettings.language = args.language;

  return {
    providerId: args.providerId,
    modelId: args.modelId,
    recipeId: null,
    contractFamily: "transcription",
    executionAdapter: "transcription",
    maxTokens: 4096,
    providerSettings,
    toolPolicy: {},
    responsePolicy: {},
  };
}

/**
 * Transcribe an audio payload.
 *
 * @throws NoTranscriptionEndpointError when the routing layer has no
 *         transcription endpoint configured (admin has not seeded any STT
 *         provider yet).
 * @throws InferenceError when the provider returns an error or is unreachable.
 */
export async function transcribe(input: TranscribeInput): Promise<TranscribeResult> {
  const endpoint = await resolveTranscriptionEndpoint({ tierHint: input.tierHint });

  const gateResult = classifyBiasPrompt({
    bias: input.biasPrompt,
    providerId: endpoint.providerId,
  });

  const plan = buildTranscriptionPlan({
    providerId: endpoint.providerId,
    modelId: endpoint.modelId,
    biasPrompt: gateResult.prompt,
    language: input.language,
  });

  const messages = buildAudioMessages(input.audioBase64, input.mimeType);

  const inference: InferenceResult = await callProvider(
    endpoint.providerId,
    endpoint.modelId,
    messages,
    "", // no systemPrompt for transcription
    undefined, // no tools
    plan,
  );

  // The transcription adapter returns the full provider response in `raw`.
  // ai-inference.ts now passes it through into InferenceResult.raw (additive
  // optional field). Confidence normalization reads avg_logprob / no_speech_prob
  // (Whisper-family) or the native confidence (Deepgram/AssemblyAI).
  const raw = inference.raw;
  const conf = normalizeConfidence(raw, endpoint.providerId);

  const detectedLanguage =
    raw !== null &&
    typeof raw === "object" &&
    "language" in raw &&
    typeof (raw as { language: unknown }).language === "string"
      ? ((raw as { language: string }).language)
      : input.language;

  const biasUsed = (input.biasPrompt?.length ?? 0) > 0;

  return {
    text: inference.content,
    rawText: inference.content, // Slice 2 will populate rawText separately when cleanup runs
    confidence: conf.value,
    confidenceSource: conf.source,
    language: detectedLanguage,
    durationMs: inference.inferenceMs,
    provider: endpoint.providerId,
    model: endpoint.modelId,
    biasUsed,
    biasRedacted: gateResult.redacted,
  };
}
