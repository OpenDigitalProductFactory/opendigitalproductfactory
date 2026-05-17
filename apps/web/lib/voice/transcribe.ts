/**
 * Voice Input — transcribe() call-site.
 *
 * Owning specs:
 * - Slice 1 plan: docs/superpowers/plans/2026-05-16-voice-input-slice-1-portal-mic.md
 * - Slice 2 plan: docs/superpowers/plans/2026-05-17-voice-input-slice-2-cleanup-and-bias.md
 * - Spec: docs/superpowers/specs/2026-05-16-voice-input-and-transcription-design.md §6.5, §8
 *
 * Thin wrapper around the routing layer's callProvider. Builds an
 * AdapterRequest with the audio as a `type:"audio"` content part on the
 * trailing user message, sets executionAdapter="transcription" so callProvider
 * dispatches to the registered transcription adapter (apps/web/lib/routing/
 * transcription-adapter.ts), applies the bias-classification gate before any
 * off-org send, and projects the result.
 *
 * Slice 2 additions:
 * - When caller didn't supply biasPrompt, build it server-side from
 *   organizationId + threadId context via buildVocabularyBias.
 * - After STT pass, run cleanupTranscript on the raw text. tierHint="high-accuracy"
 *   or input.skipCleanup=true bypass cleanup; otherwise cleanup runs with a
 *   short timeout and falls through to raw on failure.
 * - Persist a TranscriptCleanupAudit row when injection was suspected OR the
 *   Levenshtein ratio exceeds the audit threshold (0.3).
 *
 * The architecture test asserts /api/transcribe routes through the registry
 * adapter — this file does NOT construct multipart bodies, does NOT call the
 * speaches sidecar directly, and does NOT import transcription-adapter
 * internals. Slice 2 also does NOT call the cleanup LLM directly — composition
 * via routeAndCall in transcript-cleanup.ts only.
 */

import { prisma } from "@dpf/db";

import { callProvider, type InferenceResult, type ChatMessage } from "@/lib/inference/ai-inference";
import type { RoutedExecutionPlan } from "@/lib/routing/recipe-types";

import { classifyBiasPrompt } from "./bias-classification-gate";
import { cleanupTranscript, type CleanupResult } from "./transcript-cleanup";
import { normalizeConfidence } from "./confidence-normalize";
import { resolveTranscriptionEndpoint } from "./endpoint-resolution";
import { buildVocabularyBias } from "./vocabulary-bias";
import type { TranscribeInput, TranscribeResult } from "./types";

/** Audit row is written when ratio exceeds this — see spec §9. */
const CLEANUP_AUDIT_RATIO_THRESHOLD = 0.3;

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

async function persistCleanupAudit(args: {
  rawText: string;
  cleanup: CleanupResult;
  threadId?: string;
}): Promise<void> {
  try {
    await prisma.transcriptCleanupAudit.create({
      data: {
        threadId: args.threadId ?? null,
        rawText: args.rawText,
        cleanedText: args.cleanup.text,
        levenshteinRatio: args.cleanup.levenshteinRatio,
        injectionSuspected: args.cleanup.injectionSuspected,
        injectionIndicators: args.cleanup.injectionIndicators,
        providerId: args.cleanup.providerId ?? null,
        modelId: args.cleanup.modelId ?? null,
        durationMs: args.cleanup.durationMs ?? null,
      },
    });
  } catch (err) {
    // Audit is best-effort. Never let a logging failure break the user's
    // transcription. Surface to server logs only.
    // eslint-disable-next-line no-console
    console.warn("[voice] cleanup audit write failed:", err);
  }
}

/**
 * Transcribe an audio payload.
 *
 * @throws NoTranscriptionEndpointError when the routing layer has no
 *         transcription endpoint configured (admin has not seeded any STT
 *         provider yet).
 * @throws InferenceError when the STT provider returns an error or is unreachable.
 *         (Cleanup-pass errors never propagate — they fall through to raw.)
 */
export async function transcribe(input: TranscribeInput): Promise<TranscribeResult> {
  const endpoint = await resolveTranscriptionEndpoint({ tierHint: input.tierHint });

  // ── 1. Resolve bias prompt ──────────────────────────────────────────────
  // Slice 2: when the caller did not pass biasPrompt explicitly, build it
  // server-side from request context. Test-harness callers continue to be
  // able to pin an explicit prompt.
  let biasTokens = input.biasPrompt;
  if (biasTokens === undefined) {
    try {
      biasTokens = await buildVocabularyBias({
        organizationId: input.organizationId,
        threadId: input.threadId,
      });
    } catch (err) {
      // Bias is a quality bump, never load-bearing. Log + continue with empty.
      // eslint-disable-next-line no-console
      console.warn("[voice] vocabulary-bias build failed:", err);
      biasTokens = [];
    }
  }

  const gateResult = classifyBiasPrompt({
    bias: biasTokens,
    providerId: endpoint.providerId,
  });

  // ── 2. Run STT ──────────────────────────────────────────────────────────
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

  const rawText = inference.content;
  const raw = inference.raw;
  const conf = normalizeConfidence(raw, endpoint.providerId);

  const detectedLanguage =
    raw !== null &&
    typeof raw === "object" &&
    "language" in raw &&
    typeof (raw as { language: unknown }).language === "string"
      ? ((raw as { language: string }).language)
      : input.language;

  const biasUsed = (biasTokens?.length ?? 0) > 0;

  // ── 3. Run cleanup pass (Slice 2) ───────────────────────────────────────
  // Default ON. Skip when the caller explicitly opted out via skipCleanup OR
  // requested high-accuracy mode (high-accuracy users want the raw model
  // output, not a polished version).
  const skipCleanup = input.skipCleanup === true || input.tierHint === "high-accuracy";
  let finalText = rawText;
  let cleanupApplied = false;
  let cleanupInjectionSuspected = false;
  let cleanupLevenshteinRatio = 0;

  if (!skipCleanup) {
    const cleanup = await cleanupTranscript(rawText);
    finalText = cleanup.text;
    cleanupApplied = cleanup.cleaned;
    cleanupInjectionSuspected = cleanup.injectionSuspected;
    cleanupLevenshteinRatio = cleanup.levenshteinRatio;

    // Audit row — only when cleanup either suspected injection OR materially
    // rewrote the user's content. Spec §9: no-op cleanups are NOT logged.
    if (cleanup.injectionSuspected || cleanup.levenshteinRatio > CLEANUP_AUDIT_RATIO_THRESHOLD) {
      await persistCleanupAudit({ rawText, cleanup, threadId: input.threadId });
    }
  }

  return {
    text: finalText,
    rawText,
    confidence: conf.value,
    confidenceSource: conf.source,
    language: detectedLanguage,
    durationMs: inference.inferenceMs,
    provider: endpoint.providerId,
    model: endpoint.modelId,
    biasUsed,
    biasRedacted: gateResult.redacted,
    cleanupApplied,
    cleanupInjectionSuspected,
    cleanupLevenshteinRatio,
  };
}
