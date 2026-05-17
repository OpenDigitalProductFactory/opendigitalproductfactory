/**
 * Voice Input Slice 1 / Task 5 — per-provider transcript confidence normalization.
 *
 * Owning plan: docs/superpowers/plans/2026-05-16-voice-input-slice-1-portal-mic.md
 * Owning spec: docs/superpowers/specs/2026-05-16-voice-input-and-transcription-design.md §6.5
 *
 * Whisper-family engines emit per-segment `avg_logprob` and `no_speech_prob`.
 * Hosted providers (Deepgram, AssemblyAI) emit `confidence` directly as a 0-1
 * number. This function projects all of them to a single 0-1 float so
 * downstream thresholds (§7.2 + §10 Q3) operate on a uniform scale.
 *
 * Per spec §6.5 formula table:
 *
 *   | Provider family                                  | Formula                                                |
 *   | Whisper / faster-whisper / speaches / whisper.cpp / Groq Whisper | clamp(exp(mean(segment.avg_logprob)), 0, 1) over all returned segments; fallback to (1 - no_speech_prob) if segments empty |
 *   | Deepgram Nova-3                                  | channels[0].alternatives[0].confidence (already 0-1)   |
 *   | AssemblyAI                                       | confidence (already 0-1)                                |
 */

/** Source describes which formula produced the value. Downstream UI surfaces
 *  this to make confidence-source transparent and to support per-provider
 *  threshold tuning per spec §10 Q3 (0.85 for native, 0.80 for normalized-Whisper). */
export type ConfidenceSource = "normalized" | "native" | "unavailable";

export interface NormalizedConfidence {
  value: number | null;
  source: ConfidenceSource;
}

/** Provider IDs whose response shape uses Whisper's verbose_json format. */
const WHISPER_FAMILY_PROVIDERS: ReadonlySet<string> = new Set([
  "speaches",
  "whisper-cpp-local",
  "faster-whisper",
  "groq",
  "groq-whisper",
]);

function isWhisperFamily(providerId: string): boolean {
  return WHISPER_FAMILY_PROVIDERS.has(providerId);
}

function clamp01(n: number): number {
  if (!Number.isFinite(n)) return 0;
  if (n < 0) return 0;
  if (n > 1) return 1;
  return n;
}

/** Extract Whisper-shape confidence from segments + no_speech_prob fallback. */
function normalizeWhisper(raw: Record<string, unknown>): NormalizedConfidence {
  const segments = raw.segments;
  if (Array.isArray(segments) && segments.length > 0) {
    const logprobs: number[] = [];
    for (const seg of segments) {
      if (seg && typeof seg === "object") {
        const lp = (seg as Record<string, unknown>).avg_logprob;
        if (typeof lp === "number" && Number.isFinite(lp)) {
          logprobs.push(lp);
        }
      }
    }
    if (logprobs.length > 0) {
      const mean = logprobs.reduce((a, b) => a + b, 0) / logprobs.length;
      return { value: clamp01(Math.exp(mean)), source: "normalized" };
    }
  }

  const nsp = raw.no_speech_prob;
  if (typeof nsp === "number" && Number.isFinite(nsp)) {
    return { value: clamp01(1 - nsp), source: "normalized" };
  }

  return { value: null, source: "unavailable" };
}

/** Extract Deepgram-shape confidence from results.channels[0].alternatives[0].confidence. */
function normalizeDeepgram(raw: Record<string, unknown>): NormalizedConfidence {
  const results = raw.results as Record<string, unknown> | undefined;
  const channels = results?.channels;
  if (Array.isArray(channels) && channels.length > 0) {
    const channel = channels[0] as Record<string, unknown>;
    const alternatives = channel?.alternatives;
    if (Array.isArray(alternatives) && alternatives.length > 0) {
      const alt = alternatives[0] as Record<string, unknown>;
      const confidence = alt?.confidence;
      if (typeof confidence === "number" && Number.isFinite(confidence)) {
        return { value: clamp01(confidence), source: "native" };
      }
    }
  }
  return { value: null, source: "unavailable" };
}

/** Extract AssemblyAI top-level confidence. */
function normalizeAssemblyAi(raw: Record<string, unknown>): NormalizedConfidence {
  const confidence = raw.confidence;
  if (typeof confidence === "number" && Number.isFinite(confidence)) {
    return { value: clamp01(confidence), source: "native" };
  }
  return { value: null, source: "unavailable" };
}

/**
 * Normalize a raw transcription response to a 0-1 confidence value.
 *
 * @param raw  The provider's response body (or `AdapterResult.raw`).
 * @param providerId  Provider id from the routing layer (e.g. "speaches").
 *                    Drives which formula is applied.
 */
export function normalizeConfidence(
  raw: unknown,
  providerId: string,
): NormalizedConfidence {
  if (raw === null || raw === undefined || typeof raw !== "object") {
    return { value: null, source: "unavailable" };
  }
  const record = raw as Record<string, unknown>;

  if (isWhisperFamily(providerId)) {
    return normalizeWhisper(record);
  }
  if (providerId === "deepgram") {
    return normalizeDeepgram(record);
  }
  if (providerId === "assemblyai") {
    return normalizeAssemblyAi(record);
  }

  // Unknown provider — try Whisper shape first (most common OpenAI-compatible
  // endpoints emit it), fall back to unavailable.
  const whisperShot = normalizeWhisper(record);
  if (whisperShot.source !== "unavailable") return whisperShot;
  return { value: null, source: "unavailable" };
}
