/**
 * Voice Input Slice 1 — public types for the transcribe() call-site.
 *
 * Owning plan: docs/superpowers/plans/2026-05-16-voice-input-slice-1-portal-mic.md
 * Owning spec: docs/superpowers/specs/2026-05-16-voice-input-and-transcription-design.md §6.5
 */

import type { BiasClassificationToken } from "./bias-classification-gate";
import type { ConfidenceSource } from "./confidence-normalize";

/**
 * Where the transcribe call originated. Drives bias resolution (Slice 2),
 * principal resolution (Slice 3), and telemetry tagging.
 */
export type TranscribeContext = "coworker_panel" | "inbound_channel" | "test_harness";

/**
 * Routing-tier hint. ADVISORY only — the canonical contract per spec §6.5 is
 * taskType="transcription" + the capability tier resolved by the routing
 * layer. tierHint biases tie-breaks; it does not pin a provider.
 */
export type TierHint = "small" | "high-accuracy";

export interface TranscribeInput {
  /** Audio payload as a base64 string. The adapter builds the multipart body. */
  audioBase64: string;
  /** MIME type of the original audio (audio/webm, audio/mp4, audio/ogg, etc.). */
  mimeType: string;
  context: TranscribeContext;
  /** Thread context for the portal mic — used to scope bias vocabulary (Slice 2). */
  threadId?: string;
  /** Channel binding for inbound voice — used by Slice 3 (fabric inbound). */
  channelBindingId?: string;
  /** ISO-639-1 language hint; provider auto-detects when omitted. */
  language?: string;
  /** Optional capability-tier hint (advisory; routing layer owns selection). */
  tierHint?: TierHint;
  /**
   * Optional bias prompt as classified tokens. Slice 1 callers pass undefined
   * or []; Slice 2 vocabulary builder populates this. The classification gate
   * (`bias-classification-gate.ts`) strips off-org-unsafe tokens before send.
   */
  biasPrompt?: BiasClassificationToken[];
}

export interface TranscribeResult {
  /** Final transcript text (raw in Slice 1; will be cleaned in Slice 2). */
  text: string;
  /**
   * Pre-cleanup text. In Slice 1 the cleanup pass is absent, so this equals
   * `text`. Slice 2 populates this with the raw STT output for audit.
   */
  rawText: string;
  /** Normalized 0-1 confidence; null when no confidence shape was returned. */
  confidence: number | null;
  /** Which formula produced `confidence` — surfaces per-source threshold tuning. */
  confidenceSource: ConfidenceSource;
  /** Detected language code (ISO-639-1) if the provider returned one. */
  language?: string;
  /** Wall-clock duration of the provider call in milliseconds. */
  durationMs: number;
  /** Provider id that handled the request (e.g. "speaches"). */
  provider: string;
  /** Model id within the provider (e.g. "Systran/faster-distil-whisper-large-v3"). */
  model: string;
  /** True if the caller passed a non-empty bias prompt. */
  biasUsed: boolean;
  /** True if the classification gate stripped any tokens before send. */
  biasRedacted: boolean;
}

/**
 * Endpoint resolution result — what the routing-layer lookup returns before
 * dispatch. Slice 1 uses a minimal lookup (top-scored unblocked
 * EndpointTaskPerformance row for taskType="transcription"); Slice 2 will
 * fold this into the canonical routing path.
 */
export interface ResolvedTranscriptionEndpoint {
  providerId: string;
  modelId: string;
}
